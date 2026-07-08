/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

const TARGET_DIRS = [
  path.join(__dirname, '../src/app'),
  path.join(__dirname, '../src/components'),
  path.join(__dirname, '../src/hooks'),
];

// Allowlist for brand names, technical terms, symbols, and empty states
const ALLOWLIST = [
  'arenaquest',
  'arena',
  'quest',
  'aq',
  'next',
  'roboto',
  'inter',
  'sans-serif',
  'utf-8',
];

function isAllowed(str) {
  const normalized = str.trim().toLowerCase();
  if (!normalized) return true;
  // If it only contains numbers, symbols, emoji, or whitespace
  if (/^[0-9\s\-_.:,;!@#$%^&*()_+={}[\]|\\/<>`~'"?•🎬📚🕒📦📭✓←→🎨🎯🏋️]*$/.test(normalized)) return true;
  if (isCode(str)) return true;
  return ALLOWLIST.some(item => normalized === item || normalized.includes(item));
}

function isCode(str) {
  // Ignore typescript/javascript signatures, variables, keywords, and code structures
  if (/\b(const|let|var|export|import|from|function|return|satisfies|Record|forwardRef|Promise|type|interface|any|unknown|string|number|boolean|void)\b/.test(str)) return true;
  if (str.includes('=>') || str.includes('(') || str.includes(')') || str.includes(':') || str.includes(';') || str.includes('?') || str.includes('||') || str.includes('&&') || str.includes('?') || str.includes('=')) return true;
  return false;
}

function stripCurlyBraces(str) {
  let result = '';
  let braceCount = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '{') {
      braceCount++;
    } else if (char === '}') {
      braceCount = Math.max(0, braceCount - 1);
    } else if (braceCount === 0) {
      result += char;
    }
  }
  return result;
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Strip comments to avoid false positives
  let processed = content
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\/\/.*/g, '');          // line comments

  // Strip all JSX expressions in curly braces to avoid matching JS logic
  processed = stripCurlyBraces(processed);

  const errors = [];

  // 1. Scan for JSX text children: e.g. >Some Text<
  // We match text between > and < on a SINGLE line that contains letters
  const jsxTextRegex = />\s*([^<{>\s\r\n][^<{>\r\n]*[a-zA-ZÀ-ÿ][^<{>\r\n]*)\s*</g;
  let match;
  while ((match = jsxTextRegex.exec(processed)) !== null) {
    const text = match[1].trim();
    if (!isAllowed(text)) {
      const lineNum = getLineNumber(content, match.index);
      errors.push({
        line: lineNum,
        text: text,
        type: 'JSX Text Child',
      });
    }
  }

  // 2. Scan for hardcoded attributes: placeholder="...", title="...", aria-label="...", alt="..."
  const attrRegex = /\b(placeholder|title|aria-label|alt)\s*=\s*"([^"{]+)"/g;
  while ((match = attrRegex.exec(processed)) !== null) {
    const attr = match[1];
    const val = match[2].trim();
    if (!isAllowed(val)) {
      const lineNum = getLineNumber(content, match.index);
      errors.push({
        line: lineNum,
        text: `${attr}="${val}"`,
        type: 'Hardcoded Attribute',
      });
    }
  }

  return errors;
}

function getLineNumber(content, index) {
  return content.substring(0, index).split('\n').length;
}

function walkDir(dir, callback) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (file !== '__tests__' && file !== 'node_modules') {
        walkDir(filePath, callback);
      }
    } else if (stat.isFile() && (file.endsWith('.tsx') || file.endsWith('.ts'))) {
      callback(filePath);
    }
  }
}

let totalErrors = 0;
const allErrors = {};

console.log('🔍 Scanning apps/web/src for hardcoded user-facing strings...');

for (const dir of TARGET_DIRS) {
  walkDir(dir, (filePath) => {
    const relativePath = path.relative(path.join(__dirname, '..'), filePath);
    
    // Skip dict files, types, and public landing page
    if (
      relativePath.includes('src/i18n/') || 
      relativePath.includes('src/lib/api-types.gen.ts') ||
      relativePath === 'src/app/page.tsx'
    ) {
      return;
    }

    const fileErrors = scanFile(filePath);
    if (fileErrors.length > 0) {
      allErrors[relativePath] = fileErrors;
      totalErrors += fileErrors.length;
    }
  });
}

if (totalErrors > 0) {
  console.error(`\n❌ Found ${totalErrors} hardcoded user-facing strings:\n`);
  for (const [file, errors] of Object.entries(allErrors)) {
    console.error(`📂 ${file}:`);
    for (const err of errors) {
      console.error(`  Line ${err.line}: [${err.type}] "${err.text}"`);
    }
  }
  process.exit(1);
} else {
  console.log('✅ Success: Zero hardcoded user-facing strings found under apps/web/src!');
  process.exit(0);
}
