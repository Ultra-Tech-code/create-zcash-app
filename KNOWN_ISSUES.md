# Known Issues

- anchor 1c5a7114... from P1's old chain is unexplained and unreproducible
- the upstream proto diff output and the benchmark runs (1203-1215 blocks/s) have no committed raw logs
- no committed fixture yet of a block containing Ironwood actions from a funding tx
- the wipe refusal-without---yes test is not committed
- regtest chain activates NU6.3 at height 2 with empty Orchard commitment tree (0 notes, finalState 000000); live Orchard note spend rejected by Zebra consensus due to unknown Orchard anchor
