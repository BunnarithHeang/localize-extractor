import express from 'express';
import cors from 'cors';

// Hard cap on key length: trim whole camelCase words until it fits
const MAX_KEY_LENGTH = 30;
const enforceMaxLength = (key: string): string => {
  if (key.length <= MAX_KEY_LENGTH) return key;
  const parts = key.split(/(?=[A-Z])/); // split on camelCase boundaries
  let result = parts[0];
  for (let i = 1; i < parts.length; i++) {
    if (result.length + parts[i].length > MAX_KEY_LENGTH) break;
    result += parts[i];
  }
  return result.slice(0, MAX_KEY_LENGTH);
};

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

app.post('/generate-key', async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  try {
    const prompt = `You are a localization expert.
Convert the following user text into a camelCase localization key.
Use appropriate prefixes based on the context of the text (e.g., 'title', 'label', 'error', 'btn', 'desc').
If it's an action, maybe use 'btn'. If it's a short descriptive text, use 'label'. If it's a heading, use 'title'.
Keep the key SHORT: summarize the meaning in at most 3-4 words after the prefix (max ~30 characters total).
Drop filler words (a, the, of, to, and, your, please...) and condense long sentences to their core meaning.
Example: "Please enter your email address to continue" -> labelEnterEmail
Example: "Are you sure you want to delete this item?" -> confirmDeleteItem
Return ONLY the final string for the key without any quotes, markdown formatting, or explanation.
Example input: "Sign In" -> Output: titleSignIn or btnSignIn (choose the most logical one)

Text to convert: "${text}"`;

    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3.1', // Adjust to the user's specific model if needed
        prompt: prompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API responded with status: ${response.status}`);
    }

    const data = await response.json();
    const generatedKey = data.response.trim().replace(/^['"](.*)['"]$/, '$1'); // Remove any surrounding quotes just in case

    res.json({ key: enforceMaxLength(generatedKey) });
  } catch (error: any) {
    console.error('Error generating key:', error.message);
    res.status(500).json({ error: 'Failed to generate key', details: error.message });
  }
});

app.listen(port, () => {
  console.log(`Backend server listening at http://localhost:${port}`);
});
