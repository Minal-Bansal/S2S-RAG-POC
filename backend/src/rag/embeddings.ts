import { AzureOpenAI } from "openai";
import { config } from "../config.js";

const client = new AzureOpenAI({
  endpoint: config.azureEndpoint,
  apiKey: config.azureApiKey,
  apiVersion: config.azureApiVersion,
  deployment: config.azureEmbeddingDeployment,
});

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const res = await client.embeddings.create({
    model: config.azureEmbeddingDeployment,
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}

export async function embedText(text: string): Promise<number[]> {
  const [vec] = await embedTexts([text]);
  return vec;
}
