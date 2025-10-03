const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');

class EmbeddingService {
  constructor(apiKey, options = {}) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    
    // Use only Gemini 1.5 Pro for all operations
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
    this.embeddingModel = this.genAI.getGenerativeModel({ model: 'text-embedding-004' }); // For text embeddings
  }

  /**
   * Generate multimodal embeddings using Gemini 1.5 Pro for text and images
   * @param {Object} content - Content object with text and/or images
   * @returns {Promise<Object>} - Multimodal embedding result
   */
  async generateMultimodalEmbedding(content) {
    try {
      const parts = [];

      // Add text content
      if (content.text) {
        parts.push({ text: content.text });
      }

      // Add image content
      if (content.images && content.images.length > 0) {
        for (const image of content.images) {
          if (typeof image === 'string') {
            // Image is a file path
            const imageData = fs.readFileSync(image);
            const mimeType = this.getMimeType(image);
            parts.push({
              inlineData: {
                data: imageData.toString('base64'),
                mimeType: mimeType
              }
            });
          } else if (image.data && image.mimeType) {
            // Image is already in the correct format
            parts.push({
              inlineData: {
                data: image.data,
                mimeType: image.mimeType
              }
            });
          }
        }
      }

      if (parts.length === 0) {
        throw new Error('No content provided for multimodal embedding');
      }

      // Use Gemini 1.5 Pro to create semantic descriptions of multimodal content
      const prompt = this.buildMultimodalPrompt(content);
      parts.unshift({ text: prompt });

      const result = await this.model.generateContent({
        contents: [{ parts }]
      });

      const generatedText = result.response.text();
      
      // Now generate embeddings from the multimodal description
      const embeddingResult = await this.generateTextEmbedding(generatedText);

      return {
        values: embeddingResult.values,
        model: 'gemini-1.5-pro',
        dimensions: embeddingResult.dimensions,
        multimodalDescription: generatedText,
        contentTypes: this.analyzeMultimodalContent(content)
      };
    } catch (error) {
      console.error('Error generating multimodal embedding:', error);
      throw error;
    }
  }

  /**
   * Generate embeddings for text content
   * @param {string} text - Text to generate embeddings for
   * @returns {Promise<Object>} - Vector embeddings with metadata
   */
  async generateEmbedding(text) {
    return await this.generateTextEmbedding(text);
  }

  /**
   * Generate text-only embeddings using text-embedding-004
   * @param {string} text - Text to generate embeddings for
   * @returns {Promise<Object>} - Vector embeddings with metadata
   */
  async generateTextEmbedding(text) {
    try {
      const result = await this.embeddingModel.embedContent(text);
      
      return {
        values: result.embedding.values,
        model: 'text-embedding-004',
        dimensions: result.embedding.values.length
      };
    } catch (error) {
      console.error('Error generating text embedding:', error);
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple text chunks in batch
   * @param {Array<string>} texts - Array of texts to generate embeddings for
   * @returns {Promise<Array<Object>>} - Array of embedding objects with metadata
   */
  async generateEmbeddingsBatch(texts) {
    try {
      const embeddings = [];
      
      // Process in smaller batches to avoid rate limits
      const batchSize = 10;
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const batchPromises = batch.map(text => this.generateEmbedding(text));
        const batchEmbeddings = await Promise.all(batchPromises);
        embeddings.push(...batchEmbeddings);
        
        // Add small delay between batches to respect rate limits
        if (i + batchSize < texts.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      return embeddings;
    } catch (error) {
      console.error('Error generating batch embeddings:', error);
      throw error;
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   * @param {Array<number>} vectorA - First vector
   * @param {Array<number>} vectorB - Second vector
   * @returns {number} - Cosine similarity score (0-1)
   */
  calculateCosineSimilarity(vectorA, vectorB) {
    if (vectorA.length !== vectorB.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vectorA.length; i++) {
      dotProduct += vectorA[i] * vectorB[i];
      normA += vectorA[i] * vectorA[i];
      normB += vectorB[i] * vectorB[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * Find most similar chunks to a query vector
   * @param {Array<number>} queryVector - Query vector
   * @param {Array<Object>} chunks - Array of chunks with embeddings
   * @param {number} topK - Number of top similar chunks to return
   * @param {number} threshold - Minimum similarity threshold
   * @returns {Array<Object>} - Top similar chunks with similarity scores
   */
  findSimilarChunks(queryVector, chunks, topK = 5, threshold = 0.7) {
    const similarities = chunks.map(chunk => ({
      ...chunk,
      similarity: this.calculateCosineSimilarity(queryVector, chunk.embedding)
    }));

    return similarities
      .filter(chunk => chunk.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  /**
   * Generate query embedding and find similar chunks
   * @param {string} query - User query
   * @param {Array<Object>} chunks - Array of chunks with embeddings
   * @param {number} topK - Number of top similar chunks to return
   * @param {number} threshold - Minimum similarity threshold
   * @returns {Promise<Array<Object>>} - Top similar chunks with similarity scores
   */
  async searchSimilarChunks(query, chunks, topK = 5, threshold = 0.7) {
    try {
      const queryEmbedding = await this.generateEmbedding(query);
      return this.findSimilarChunks(queryEmbedding.values, chunks, topK, threshold);
    } catch (error) {
      console.error('Error searching similar chunks:', error);
      throw error;
    }
  }

  /**
   * Build prompt for multimodal content processing using Gemini 1.5 Pro
   * @param {Object} content - Content object with text and/or images
   * @returns {string} - Formatted prompt
   */
  buildMultimodalPrompt(content) {
    let prompt = `Analyze this insurance policy content (text and images) and provide a comprehensive, detailed description that captures all the key information, visual elements, and context. This will be used for semantic search and retrieval.

Focus on:
1. All text content and its meaning
2. Visual elements in images (charts, diagrams, tables, forms)
3. Relationships between text and visual content
4. Key information relevant for insurance policy queries
5. Policy details, coverage information, terms and conditions
6. Key dates, amounts, policy numbers, coverage limits and deductibles
7. Any data, numbers, or specific details visible

`;

    if (content.text) {
      prompt += `Text Content: ${content.text}\n\n`;
    }

    if (content.images && content.images.length > 0) {
      prompt += `Please analyze the ${content.images.length} image(s) provided and describe their content in detail.\n\n`;
    }

    return prompt;
  }

  /**
   * Analyze multimodal content to determine content types
   * @param {Object} content - Content object with text and/or images
   * @returns {Array<string>} - Array of content types
   */
  analyzeMultimodalContent(content) {
    const types = [];
    
    if (content.text) {
      types.push('text');
    }
    
    if (content.images && content.images.length > 0) {
      types.push('image');
      types.push('multimodal');
    }
    
    return types;
  }

  /**
   * Get MIME type from file extension
   * @param {string} filePath - File path
   * @returns {string} - MIME type
   */
  getMimeType(filePath) {
    const extension = filePath.toLowerCase().split('.').pop();
    const mimeTypes = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'webp': 'image/webp',
      'heic': 'image/heic',
      'heif': 'image/heif'
    };
    return mimeTypes[extension] || 'image/jpeg';
  }

  /**
   * Generate embeddings for multimodal content with automatic fallback
   * @param {Object|string} content - Content (multimodal object or text string)
   * @returns {Promise<Object>} - Embedding with metadata
   */
  async generateSmartMultimodalEmbedding(content) {
    try {
      // If content is just a string, use regular text embedding
      if (typeof content === 'string') {
        return await this.generateEmbedding(content);
      }

      // If content has images, use multimodal embedding
      if (content.images && content.images.length > 0) {
        return await this.generateMultimodalEmbedding(content);
      }

      // If content only has text, use text embedding
      if (content.text) {
        return await this.generateEmbedding(content.text);
      }

      throw new Error('No valid content provided');
    } catch (error) {
      console.error('Error generating smart multimodal embedding:', error);
      throw error;
    }
  }
}

module.exports = EmbeddingService;
