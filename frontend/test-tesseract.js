import { createWorker } from 'tesseract.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function test() {
  try {
    const worker = await createWorker('eng');
    console.log('Worker created');
    
    // Provide a simple local image (the same one we use for tests)
    const imgPath = path.resolve('/Users/bunnarithheang/.gemini/antigravity-ide/brain/fecbaca2-ee14-42f7-9ccd-8b6636cda131/test_login_ui_1783153603212.png');
    console.log('Recognizing image:', imgPath);
    
    // Explicitly request words in v7 output
    const { data } = await worker.recognize(imgPath, undefined, { words: true, blocks: true });
    console.log('Recognition complete.');
    console.log('Has words array?', !!data.words);
    if (data.blocks && data.blocks.length > 0) {
      console.log('First block lines:', data.blocks[0].paragraphs[0].lines[0]);
      console.log('Words in first line:', data.blocks[0].paragraphs[0].lines[0].words?.length);
      console.log('First word bbox:', data.blocks[0].paragraphs[0].lines[0].words?.[0]?.bbox);
    }
    
    await worker.terminate();
  } catch (err) {
    console.error('Error during tesseract run:', err);
  }
}

test();
