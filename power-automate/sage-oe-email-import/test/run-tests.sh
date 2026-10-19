#!/usr/bin/env bash
# Type-checks BuildSageOEImport.ts against the ExcelScript API stub, then runs the tests.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
# Office Scripts are global scripts (no imports), so the tests run as one combined script.
cat ../BuildSageOEImport.ts run-tests.ts > build/tests.ts
cp excelscript.d.ts build/
tsc --strict --noImplicitAny --target ES2017 --lib ES2017 --ignoreConfig build/excelscript.d.ts build/tests.ts
node build/tests.js
