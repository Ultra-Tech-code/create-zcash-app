#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use incrementalmerkletree::{Address, Level, Position};
use orchard::tree::MerkleHashOrchard;
use rusqlite::{named_params, Connection, OptionalExtension};
use shardtree::{
    store::{Checkpoint, ShardStore, TreeState},
    LocatedPrunableTree, PrunableTree,
};
use std::collections::BTreeSet;
use std::io::{self, Cursor};
use std::sync::Arc;
use thiserror::Error;
use zcash_client_backend::data_api::ORCHARD_SHARD_HEIGHT;
use zcash_client_backend::serialization::shardtree::{read_shard, write_shard};
use zcash_primitives::merkle_tree::HashSer;
use zcash_protocol::consensus::BlockHeight;

pub const IRONWOOD_TREE_DEPTH: u8 = orchard::NOTE_COMMITMENT_TREE_DEPTH as u8;
pub const IRONWOOD_SHARD_HEIGHT: u8 = ORCHARD_SHARD_HEIGHT;

pub type IronwoodShardTree<S> = shardtree::ShardTree<S, IRONWOOD_TREE_DEPTH, IRONWOOD_SHARD_HEIGHT>;

#[derive(Error, Debug)]
pub enum ShardStoreError {
    #[error("Database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Serialization error: {0}")]
    Serialization(#[from] io::Error),
    #[error("Checkpoint conflict at height {height:?}")]
    CheckpointConflict { height: BlockHeight },
    #[error("Invalid shard address: {0:?}")]
    InvalidAddress(String),
}

pub struct SqliteShardStore<'a> {
    conn: &'a Connection,
    table_prefix: &'static str,
    retained: BTreeSet<BlockHeight>,
}

impl<'a> SqliteShardStore<'a> {
    pub fn new(conn: &'a Connection, table_prefix: &'static str) -> Self {
        Self {
            conn,
            table_prefix,
            retained: BTreeSet::new(),
        }
    }
}

impl<'a> ShardStore for SqliteShardStore<'a> {
    type H = MerkleHashOrchard;
    type CheckpointId = BlockHeight;
    type Error = ShardStoreError;

    fn get_shard(
        &self,
        shard_root: Address,
    ) -> Result<Option<LocatedPrunableTree<Self::H>>, Self::Error> {
        let sql = format!(
            "SELECT shard_data, root_hash FROM {}_shards WHERE shard_index = :shard_index",
            self.table_prefix
        );
        let mut stmt = self.conn.prepare_cached(&sql)?;
        let row_opt = stmt
            .query_row(
                named_params![":shard_index": shard_root.index()],
                |row| {
                    let data: Vec<u8> = row.get(0)?;
                    let root: Option<Vec<u8>> = row.get(1)?;
                    Ok((data, root))
                },
            )
            .optional()?;

        match row_opt {
            None => Ok(None),
            Some((shard_data, root_hash_bytes)) => {
                let tree = read_shard(Cursor::new(shard_data))?;
                let located = LocatedPrunableTree::from_parts(shard_root, tree).map_err(|e| {
                    io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!("Invalid shard tree data: {e:?}"),
                    )
                })?;
                if let Some(hb) = root_hash_bytes {
                    let root_hash = MerkleHashOrchard::read(Cursor::new(hb))?;
                    Ok(Some(located.reannotate_root(Some(Arc::new(root_hash)))))
                } else {
                    Ok(Some(located))
                }
            }
        }
    }

    fn last_shard(&self) -> Result<Option<LocatedPrunableTree<Self::H>>, Self::Error> {
        let sql = format!(
            "SELECT shard_index, shard_data, root_hash FROM {}_shards ORDER BY shard_index DESC LIMIT 1",
            self.table_prefix
        );
        let mut stmt = self.conn.prepare_cached(&sql)?;
        let row_opt = stmt
            .query_row([], |row| {
                let idx: u64 = row.get(0)?;
                let data: Vec<u8> = row.get(1)?;
                let root: Option<Vec<u8>> = row.get(2)?;
                Ok((idx, data, root))
            })
            .optional()?;

        match row_opt {
            None => Ok(None),
            Some((shard_idx, shard_data, root_hash_bytes)) => {
                let addr = Address::from_parts(Level::new(IRONWOOD_SHARD_HEIGHT), shard_idx);
                let tree = read_shard(Cursor::new(shard_data))?;
                let located = LocatedPrunableTree::from_parts(addr, tree).map_err(|e| {
                    io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!("Invalid shard tree data: {e:?}"),
                    )
                })?;
                if let Some(hb) = root_hash_bytes {
                    let root_hash = MerkleHashOrchard::read(Cursor::new(hb))?;
                    Ok(Some(located.reannotate_root(Some(Arc::new(root_hash)))))
                } else {
                    Ok(Some(located))
                }
            }
        }
    }

    fn put_shard(&mut self, subtree: LocatedPrunableTree<Self::H>) -> Result<(), Self::Error> {
        let shard_index = subtree.root_addr().index();
        let subtree_root_hash = subtree
            .root()
            .annotation()
            .and_then(|ann| ann.as_ref())
            .map(|rc| {
                let mut bytes = vec![];
                rc.write(&mut bytes)?;
                Ok::<_, io::Error>(bytes)
            })
            .transpose()?;

        let mut shard_data = vec![];
        write_shard(&mut shard_data, subtree.root())?;

        let sql = format!(
            "INSERT INTO {}_shards (shard_index, root_hash, shard_data)
             VALUES (:shard_index, :root_hash, :shard_data)
             ON CONFLICT (shard_index) DO UPDATE
             SET root_hash = :root_hash, shard_data = :shard_data",
            self.table_prefix
        );
        let mut stmt = self.conn.prepare_cached(&sql)?;
        stmt.execute(named_params![
            ":shard_index": shard_index,
            ":root_hash": subtree_root_hash,
            ":shard_data": shard_data,
        ])?;
        Ok(())
    }

    fn get_shard_roots(&self) -> Result<Vec<Address>, Self::Error> {
        let sql = format!(
            "SELECT shard_index FROM {}_shards ORDER BY shard_index ASC",
            self.table_prefix
        );
        let mut stmt = self.conn.prepare_cached(&sql)?;
        let rows = stmt.query_map([], |row| {
            let idx: u64 = row.get(0)?;
            Ok(Address::from_parts(Level::new(IRONWOOD_SHARD_HEIGHT), idx))
        })?;

        let mut roots = vec![];
        for r in rows {
            roots.push(r?);
        }
        Ok(roots)
    }

    fn truncate_shards(&mut self, shard_index: u64) -> Result<(), Self::Error> {
        let sql = format!(
            "DELETE FROM {}_shards WHERE shard_index >= :shard_index",
            self.table_prefix
        );
        let mut stmt = self.conn.prepare_cached(&sql)?;
        stmt.execute(named_params![":shard_index": shard_index])?;
        Ok(())
    }

    fn get_cap(&self) -> Result<PrunableTree<Self::H>, Self::Error> {
        let sql = format!("SELECT cap_data FROM {}_cap WHERE cap_id = 0", self.table_prefix);
        let mut stmt = self.conn.prepare_cached(&sql)?;
        let data_opt: Option<Vec<u8>> = stmt.query_row([], |row| row.get(0)).optional()?;
        match data_opt {
            Some(bytes) => Ok(read_shard(Cursor::new(bytes))?),
            None => Ok(PrunableTree::empty()),
        }
    }

    fn put_cap(&mut self, cap: PrunableTree<Self::H>) -> Result<(), Self::Error> {
        let mut bytes = vec![];
        write_shard(&mut bytes, &cap)?;
        let sql = format!(
            "INSERT INTO {}_cap (cap_id, cap_data) VALUES (0, :cap_data)
             ON CONFLICT (cap_id) DO UPDATE SET cap_data = :cap_data",
            self.table_prefix
        );
        let mut stmt = self.conn.prepare_cached(&sql)?;
        stmt.execute(named_params![":cap_data": bytes])?;
        Ok(())
    }

    fn min_checkpoint_id(&self) -> Result<Option<Self::CheckpointId>, Self::Error> {
        let sql = format!("SELECT MIN(checkpoint_id) FROM {}_checkpoints", self.table_prefix);
        let mut stmt = self.conn.prepare_cached(&sql)?;
        let val: Option<u32> = stmt.query_row([], |row| row.get(0)).optional()?.flatten();
        Ok(val.map(BlockHeight::from))
    }

    fn max_checkpoint_id(&self) -> Result<Option<Self::CheckpointId>, Self::Error> {
        let sql = format!("SELECT MAX(checkpoint_id) FROM {}_checkpoints", self.table_prefix);
        let mut stmt = self.conn.prepare_cached(&sql)?;
        let val: Option<u32> = stmt.query_row([], |row| row.get(0)).optional()?.flatten();
        Ok(val.map(BlockHeight::from))
    }

    fn add_checkpoint(
        &mut self,
        checkpoint_id: Self::CheckpointId,
        checkpoint: Checkpoint,
    ) -> Result<(), Self::Error> {
        let pos_val: Option<u64> = match checkpoint.tree_state() {
            TreeState::Empty => None,
            TreeState::AtPosition(pos) => Some(u64::from(pos)),
        };

        let sql = format!(
            "INSERT INTO {}_checkpoints (checkpoint_id, position) VALUES (:id, :pos)
             ON CONFLICT (checkpoint_id) DO UPDATE SET position = :pos",
            self.table_prefix
        );
        let mut stmt = self.conn.prepare_cached(&sql)?;
        stmt.execute(named_params![
            ":id": u32::from(checkpoint_id),
            ":pos": pos_val,
        ])?;

        for mark in checkpoint.marks_removed() {
            let mark_sql = format!(
                "INSERT OR IGNORE INTO {}_checkpoint_marks_removed (checkpoint_id, mark_removed_position)
                 VALUES (:id, :pos)",
                self.table_prefix
            );
            let mut mark_stmt = self.conn.prepare_cached(&mark_sql)?;
            mark_stmt.execute(named_params![
                ":id": u32::from(checkpoint_id),
                ":pos": u64::from(*mark),
            ])?;
        }

        Ok(())
    }

    fn checkpoint_count(&self) -> Result<usize, Self::Error> {
        let sql = format!("SELECT COUNT(*) FROM {}_checkpoints", self.table_prefix);
        let mut stmt = self.conn.prepare_cached(&sql)?;
        let count: i64 = stmt.query_row([], |row| row.get(0))?;
        Ok(usize::try_from(count).unwrap_or(0))
    }

    fn get_checkpoint_at_depth(
        &self,
        checkpoint_depth: usize,
    ) -> Result<Option<(Self::CheckpointId, Checkpoint)>, Self::Error> {
        let sql = format!(
            "SELECT checkpoint_id, position FROM {}_checkpoints ORDER BY checkpoint_id DESC LIMIT 1 OFFSET :offset",
            self.table_prefix
        );
        let mut stmt = self.conn.prepare_cached(&sql)?;
        let row_opt = stmt
            .query_row(named_params![":offset": checkpoint_depth], |row| {
                let id: u32 = row.get(0)?;
                let pos: Option<u64> = row.get(1)?;
                Ok((id, pos))
            })
            .optional()?;

        match row_opt {
            None => Ok(None),
            Some((id, pos_opt)) => {
                let cid = BlockHeight::from(id);
                let cp = self.load_checkpoint_marks(cid, pos_opt)?;
                Ok(Some((cid, cp)))
            }
        }
    }

    fn get_checkpoint(
        &self,
        checkpoint_id: &Self::CheckpointId,
    ) -> Result<Option<Checkpoint>, Self::Error> {
        let sql = format!(
            "SELECT position FROM {}_checkpoints WHERE checkpoint_id = :id",
            self.table_prefix
        );
        let mut stmt = self.conn.prepare_cached(&sql)?;
        let pos_opt = stmt
            .query_row(named_params![":id": u32::from(*checkpoint_id)], |row| {
                row.get::<_, Option<u64>>(0)
            })
            .optional()?;

        match pos_opt {
            None => Ok(None),
            Some(pos_val) => {
                let cp = self.load_checkpoint_marks(*checkpoint_id, pos_val)?;
                Ok(Some(cp))
            }
        }
    }

    fn with_checkpoints<F>(&mut self, limit: usize, mut callback: F) -> Result<(), Self::Error>
    where
        F: FnMut(&Self::CheckpointId, &Checkpoint) -> Result<(), Self::Error>,
    {
        let sql = format!(
            "SELECT checkpoint_id, position FROM {}_checkpoints ORDER BY checkpoint_id ASC LIMIT :limit",
            self.table_prefix
        );
        let mut stmt = self.conn.prepare_cached(&sql)?;
        let rows = stmt.query_map(named_params![":limit": limit], |row| {
            let id: u32 = row.get(0)?;
            let pos: Option<u64> = row.get(1)?;
            Ok((id, pos))
        })?;

        let mut pairs = vec![];
        for r in rows {
            pairs.push(r?);
        }

        for (id, pos) in pairs {
            let cid = BlockHeight::from(id);
            let cp = self.load_checkpoint_marks(cid, pos)?;
            callback(&cid, &cp)?;
        }
        Ok(())
    }

    fn for_each_checkpoint<F>(&self, limit: usize, mut callback: F) -> Result<(), Self::Error>
    where
        F: FnMut(&Self::CheckpointId, &Checkpoint) -> Result<(), Self::Error>,
    {
        let sql = format!(
            "SELECT checkpoint_id, position FROM {}_checkpoints ORDER BY checkpoint_id ASC LIMIT :limit",
            self.table_prefix
        );
        let mut stmt = self.conn.prepare_cached(&sql)?;
        let rows = stmt.query_map(named_params![":limit": limit], |row| {
            let id: u32 = row.get(0)?;
            let pos: Option<u64> = row.get(1)?;
            Ok((id, pos))
        })?;

        let mut pairs = vec![];
        for r in rows {
            pairs.push(r?);
        }

        for (id, pos) in pairs {
            let cid = BlockHeight::from(id);
            let cp = self.load_checkpoint_marks(cid, pos)?;
            callback(&cid, &cp)?;
        }
        Ok(())
    }

    fn update_checkpoint_with<F>(
        &mut self,
        checkpoint_id: &Self::CheckpointId,
        update: F,
    ) -> Result<bool, Self::Error>
    where
        F: Fn(&mut Checkpoint) -> Result<(), Self::Error>,
    {
        let existing = self.get_checkpoint(checkpoint_id)?;
        match existing {
            None => Ok(false),
            Some(mut cp) => {
                update(&mut cp)?;
                self.add_checkpoint(*checkpoint_id, cp)?;
                Ok(true)
            }
        }
    }

    fn remove_checkpoint(&mut self, checkpoint_id: &Self::CheckpointId) -> Result<(), Self::Error> {
        let sql = format!(
            "DELETE FROM {}_checkpoints WHERE checkpoint_id = :id",
            self.table_prefix
        );
        let mut stmt = self.conn.prepare_cached(&sql)?;
        stmt.execute(named_params![":id": u32::from(*checkpoint_id)])?;
        Ok(())
    }

    fn truncate_checkpoints_retaining(
        &mut self,
        checkpoint_id: &Self::CheckpointId,
    ) -> Result<(), Self::Error> {
        let sql = format!(
            "DELETE FROM {}_checkpoints WHERE checkpoint_id > :id",
            self.table_prefix
        );
        let mut stmt = self.conn.prepare_cached(&sql)?;
        stmt.execute(named_params![":id": u32::from(*checkpoint_id)])?;
        Ok(())
    }

    fn add_retained_checkpoint(
        &mut self,
        checkpoint_id: Self::CheckpointId,
    ) -> Result<(), Self::Error> {
        self.retained.insert(checkpoint_id);
        Ok(())
    }

    fn remove_retained_checkpoint(
        &mut self,
        checkpoint_id: &Self::CheckpointId,
    ) -> Result<(), Self::Error> {
        self.retained.remove(checkpoint_id);
        Ok(())
    }

    fn retained_checkpoints(&self) -> Result<BTreeSet<Self::CheckpointId>, Self::Error> {
        Ok(self.retained.clone())
    }
}

impl<'a> SqliteShardStore<'a> {
    fn load_checkpoint_marks(
        &self,
        checkpoint_id: BlockHeight,
        pos_opt: Option<u64>,
    ) -> Result<Checkpoint, ShardStoreError> {
        let marks_sql = format!(
            "SELECT mark_removed_position FROM {}_checkpoint_marks_removed WHERE checkpoint_id = :id",
            self.table_prefix
        );
        let mut marks_stmt = self.conn.prepare_cached(&marks_sql)?;
        let mark_rows = marks_stmt.query_map(named_params![":id": u32::from(checkpoint_id)], |r| {
            let p: u64 = r.get(0)?;
            Ok(Position::from(p))
        })?;

        let mut marks_removed = BTreeSet::new();
        for m in mark_rows {
            marks_removed.insert(m?);
        }

        let state = match pos_opt {
            Some(pos) => TreeState::AtPosition(Position::from(pos)),
            None => TreeState::Empty,
        };

        Ok(Checkpoint::from_parts(state, marks_removed))
    }
}
