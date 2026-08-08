#!/bin/bash
# بناء واجهة السيرفر من ملف الـ artifact
# الاستخدام: bash scripts/build_ui.sh <path-to-AndlusIDP360.jsx>
set -e
SRC_JSX="${1:-./AndlusIDP360.jsx}"
echo "1) تحويل الواجهة..."
node scripts/transform_frontend.js "$SRC_JSX" /tmp/App.transformed.jsx
echo "2) بناء الـ bundle..."
{ echo 'const { useState, useEffect, useMemo, useRef, useCallback } = React;'; cat /tmp/App.transformed.jsx; } > /tmp/App.withhooks.jsx
npx --yes esbuild@0.19.0 /tmp/App.withhooks.jsx \
  --bundle --format=iife --outfile=public/app.bundle.js \
  --loader:.jsx=jsx --jsx=transform \
  --external:react --external:react-dom --minify
echo "✓ اكتمل البناء: public/app.bundle.js"
