import OpenAI from 'openai';
import { createReadStream } from 'fs';

let _groq: OpenAI | null = null;
function getGroq(): OpenAI {
  return _groq ??= new OpenAI({
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey: process.env.GROQ_API_KEY,
  });
}

export async function transcribeAudio(filePath: string): Promise<string> {
  const transcription = await getGroq().audio.transcriptions.create({
    file: createReadStream(filePath),
    model: 'whisper-large-v3',
    language: 'uk',
  });
  return transcription.text;
}
