# csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/seannbeez/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/seannbeez/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` answers
exactly as csv-reader does on every case — `{columns, rows, errors}` for an
input `{text, header}` — while running about 3.2× faster than the reference
on the kit's practice set (local estimate, Node 22, 1 CPU, trimmed mean over
fresh-process runs).

How it is fast: the reference walks one character at a time. This reader
never does. Most records hold no quote at all, so most records are read with
native bulk operations only — one `indexOf` to find the line end, one
`indexOf` to prove the line holds no quote, then a single `slice` and a
native `split(',')`. Only a line that holds a quote goes through the general
scanner, which finds unquoted delimiters with one shared regex and jumps
from quote to quote with `indexOf`, slicing quoted content whole and
transforming `""` and line breaks only when the slice actually holds them.
No object is allocated per field or per record. Exactness was verified
against the reference on the kit's practice set (6/6), 76 hand-written edge
cases, 3,000 random fuzz inputs, and 4 withheld large files drawn from the
kit generator's own distribution (4/4).

## Run it

```sh
node main.ts
```

`main.ts` reads every case from `/input/cases.json` (or
`$MAKEFUN_INPUT_DIR/cases.json`), answers each with `run` from `solve.js`,
and writes `/output/answers.json` (or `$MAKEFUN_OUTPUT_DIR/answers.json`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=ebv85brk&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
