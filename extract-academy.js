const fs = require('fs');
const path = require('path');

// Read the AcademyData.ts file
const fileContent = fs.readFileSync('./src/data/AcademyData.ts', 'utf-8');

// Parse articles using regex
const articleMatches = [...fileContent.matchAll(/\{\s*id:\s*'([^']+)',\s*title:\s*'([^']+)',\s*category:\s*'([^']+)',/g)];

console.log(`Found ${articleMatches.length} articles`);

// Create output directory
const outDir = './TekAcademy_Export';
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Extract each article
let extractedCount = 0;
const categoryDirs = new Set();

articleMatches.forEach((match, index) => {
  const id = match[1];
  const title = match[2];
  const category = match[3];
  
  // Create category directory
  const categoryDir = path.join(outDir, category);
  if (!categoryDirs.has(category)) {
    if (!fs.existsSync(categoryDir)) {
      fs.mkdirSync(categoryDir, { recursive: true });
    }
    categoryDirs.add(category);
  }
  
  // Find the article content
  const articleStart = fileContent.indexOf(`id: '${id}'`);
  if (articleStart === -1) return;
  
  // Find the end of this article (next article or end of array)
  let articleEnd = fileContent.indexOf('\n  {', articleStart + 1);
  if (articleEnd === -1) {
    articleEnd = fileContent.lastIndexOf('];');
  }
  
  const articleText = fileContent.substring(articleStart, articleEnd);
  
  // Extract content array
  const contentMatch = articleText.match(/content:\s*\[([\s\S]*?)\],/);
  if (!contentMatch) {
    console.log(`Could not extract content for: ${id}`);
    return;
  }
  
  // Convert to markdown
  let markdown = `# ${title}\n\n**Category:** ${category}\n**ID:** ${id}\n\n---\n\n`;
  
  const content = contentMatch[1];
  
  // Parse content blocks
  const blocks = content.match(/(?:heading|paragraph|code|callout|table)\([^)]+\)|(?:heading|paragraph|code|callout|table)\([^)]*\([^)]*\)[^)]*\)/g) || [];
  
  blocks.forEach(block => {
    if (block.startsWith('heading')) {
      const headingMatch = block.match(/heading\((\d+),\s*'([^']+)'/);
      if (headingMatch) {
        const level = parseInt(headingMatch[1]);
        const text = headingMatch[2].replace(/\\'/g, "'");
        markdown += '\n' + '#'.repeat(level) + ' ' + text + '\n\n';
      }
    } else if (block.startsWith('paragraph')) {
      const paraMatch = block.match(/paragraph\('([^']+(?:\\.[^']+)*)'\)/);
      if (paraMatch) {
        const text = paraMatch[1].replace(/\\'/g, "'").replace(/\\n/g, '\n');
        markdown += text + '\n\n';
      }
    } else if (block.startsWith('code')) {
      const codeMatch = block.match(/code\('([^']+)',\s*'([^']+(?:\\.[^']+)*)'\)/);
      if (codeMatch) {
        const lang = codeMatch[1];
        const codeText = codeMatch[2].replace(/\\n/g, '\n').replace(/\\'/g, "'");
        markdown += '```' + lang + '\n' + codeText + '\n```\n\n';
      }
    } else if (block.startsWith('callout')) {
      const calloutMatch = block.match(/callout\('([^']+)',\s*'([^']+)',\s*'([^']+(?:\\.[^']+)*)'\)/);
      if (calloutMatch) {
        const variant = calloutMatch[1];
        const ctitle = calloutMatch[2];
        const text = calloutMatch[3].replace(/\\'/g, "'");
        const emoji = { tip: '💡', warning: '⚠️', info: 'ℹ️', error: '❌' }[variant] || '📌';
        markdown += `> ${emoji} **${ctitle}**\n> \n> ${text}\n\n`;
      }
    }
  });
  
  // Write file
  const filename = path.join(categoryDir, `${id}.md`);
  fs.writeFileSync(filename, markdown);
  extractedCount++;
  
  if (extractedCount % 10 === 0) {
    console.log(`Extracted ${extractedCount} articles...`);
  }
});

console.log(`\n✅ Extraction complete!`);
console.log(`📁 ${extractedCount} articles exported to: ${outDir}/`);
console.log(`📂 ${categoryDirs.size} categories created`);
console.log(`\nCategories:`);
Array.from(categoryDirs).sort().forEach(cat => {
  const files = fs.readdirSync(path.join(outDir, cat));
  console.log(`  - ${cat} (${files.length} articles)`);
});
