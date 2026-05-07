#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const katexPath = path.join(__dirname, '../node_modules/katex/dist/katex.mjs')

console.log('Patching KaTeX to remove quirks mode check...')

try {
  let content = fs.readFileSync(katexPath, 'utf8')

  // Find and replace the quirks mode check - just comment out the throw statement
  const before = content
  content = content.replace(
    'throw new ParseError("KaTeX doesn\'t work in quirks mode.");',
    '// throw new ParseError("KaTeX doesn\'t work in quirks mode."); // Disabled for md-reader',
  )

  // Also comment out the warning
  content = content.replace(
    'typeof console !== "undefined" && console.warn("Warning: KaTeX doesn\'t work in quirks mode. Make sure your " + "website has a suitable doctype.");',
    '// typeof console !== "undefined" && console.warn("Warning: KaTeX doesn\'t work in quirks mode. Make sure your " + "website has a suitable doctype."); // Disabled for md-reader',
  )

  if (content === before) {
    console.log('⚠ KaTeX already patched or pattern not found')
  } else {
    fs.writeFileSync(katexPath, content, 'utf8')
    console.log('✓ KaTeX patched successfully!')
  }
} catch (error) {
  console.error('✗ Failed to patch KaTeX:', error.message)
  process.exit(1)
}
