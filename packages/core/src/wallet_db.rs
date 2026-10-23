#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use crate::schema::{initialize_schema, metadata_keys, SchemaError};
use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

#[derive(Error, Debug)]
pub enum WalletDbError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Schema error: {0}")]
    Schema(#[from] SchemaError),
    #[error("Metadata mismatch for '{key}': expected '{expected}', found in database '{found}'")]
    MetadataMismatch {
        key: String,
        expected: String,
        found: String,
    },
}

pub struct WalletDb {
    conn: Connection,
    path: PathBuf,
}

impl std::fmt::Debug for WalletDb {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WalletDb")
            .field("path", &self.path)
            .finish()
    }
}

impl WalletDb {
    /// Opens or initializes the wallet SQLite database at `db_path`.
    /// Enforces 0700 permissions on the parent directory and 0600 permissions on the database file.
    /// Binds network, ufvk_fingerprint, and birthday to wallet_metadata and validates against existing data.
    pub fn open_or_create(
        db_path: &Path,
        network: &str,
        ufvk_fingerprint: &str,
        birthday: Option<u32>,
    ) -> Result<Self, WalletDbError> {
        // 1. Enforce parent directory permissions (0700)
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent)?;
            #[cfg(unix)]
            {
                let mut perms = fs::metadata(parent)?.permissions();
                perms.set_mode(0o700);
                fs::set_permissions(parent, perms)?;
            }
        }

        // 2. Open connection
        let mut conn = Connection::open(db_path)?;

        // 3. Configure WAL, synchronous=FULL, busy_timeout=5000, foreign_keys=ON
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;
             PRAGMA busy_timeout = 5000;
             PRAGMA foreign_keys = ON;",
        )?;

        // 4. Enforce file permissions (0600) on created/existing DB file
        #[cfg(unix)]
        {
            if db_path.exists() {
                let mut perms = fs::metadata(db_path)?.permissions();
                perms.set_mode(0o600);
                fs::set_permissions(db_path, perms)?;
            }
        }

        // 5. Initialize schema and migrations
        initialize_schema(&mut conn)?;

        // 6. Validate and bind metadata
        Self::bind_metadata(&conn, network, ufvk_fingerprint, birthday)?;

        Ok(Self {
            conn,
            path: db_path.to_path_buf(),
        })
    }

    fn bind_metadata(
        conn: &Connection,
        network: &str,
        ufvk_fingerprint: &str,
        birthday: Option<u32>,
    ) -> Result<(), WalletDbError> {
        // Validate or set network
        if let Some(existing) = Self::get_metadata_raw(conn, metadata_keys::NETWORK)? {
            if existing != network {
                return Err(WalletDbError::MetadataMismatch {
                    key: metadata_keys::NETWORK.to_string(),
                    expected: network.to_string(),
                    found: existing,
                });
            }
        } else {
            Self::set_metadata_raw(conn, metadata_keys::NETWORK, network)?;
        }

        // Validate or set ufvk_fingerprint
        if let Some(existing) = Self::get_metadata_raw(conn, metadata_keys::UFVK_FINGERPRINT)? {
            if existing != ufvk_fingerprint {
                return Err(WalletDbError::MetadataMismatch {
                    key: metadata_keys::UFVK_FINGERPRINT.to_string(),
                    expected: ufvk_fingerprint.to_string(),
                    found: existing,
                });
            }
        } else {
            Self::set_metadata_raw(conn, metadata_keys::UFVK_FINGERPRINT, ufvk_fingerprint)?;
        }

        // Set birthday if provided and not present
        if let Some(bday) = birthday {
            if Self::get_metadata_raw(conn, metadata_keys::BIRTHDAY)?.is_none() {
                Self::set_metadata_raw(conn, metadata_keys::BIRTHDAY, &bday.to_string())?;
            }
        }

        // Set tree_valid default if not present
        if Self::get_metadata_raw(conn, metadata_keys::TREE_VALID)?.is_none() {
            Self::set_metadata_raw(conn, metadata_keys::TREE_VALID, "true")?;
        }

        Ok(())
    }

    fn get_metadata_raw(conn: &Connection, key: &str) -> Result<Option<String>, rusqlite::Error> {
        conn.query_row(
            "SELECT value FROM wallet_metadata WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
    }

    fn set_metadata_raw(conn: &Connection, key: &str, val: &str) -> Result<(), rusqlite::Error> {
        conn.execute(
            "INSERT OR REPLACE INTO wallet_metadata (key, value) VALUES (?1, ?2)",
            params![key, val],
        )?;
        Ok(())
    }

    pub fn get_metadata(&self, key: &str) -> Result<Option<String>, WalletDbError> {
        Ok(Self::get_metadata_raw(&self.conn, key)?)
    }

    pub fn set_metadata(&self, key: &str, val: &str) -> Result<(), WalletDbError> {
        Ok(Self::set_metadata_raw(&self.conn, key, val)?)
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    pub fn conn_mut(&mut self) -> &mut Connection {
        &mut self.conn
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}
