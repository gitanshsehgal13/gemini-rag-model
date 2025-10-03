const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class VectorStore {
  constructor(storageDir = './data') {
    this.storageDir = storageDir;
    this.documentsFile = path.join(storageDir, 'documents.json');
    this.chunksFile = path.join(storageDir, 'chunks.json');
    this.customersFile = path.join(storageDir, 'customers.json');
    
    this.documents = new Map();
    this.chunks = new Map();
    this.customers = new Map();
    
    this.initializeStorage();
  }

  /**
   * Initialize storage directory and load existing data
   */
  async initializeStorage() {
    try {
      await fs.ensureDir(this.storageDir);
      await this.loadData();
    } catch (error) {
      console.error('Error initializing storage:', error);
    }
  }

  /**
   * Load existing data from storage files
   */
  async loadData() {
    try {
      // Load documents
      if (await fs.pathExists(this.documentsFile)) {
        const documentsData = await fs.readJson(this.documentsFile);
        this.documents = new Map(Object.entries(documentsData));
      }

      // Load chunks
      if (await fs.pathExists(this.chunksFile)) {
        const chunksData = await fs.readJson(this.chunksFile);
        this.chunks = new Map(Object.entries(chunksData));
      }

      // Load customers
      if (await fs.pathExists(this.customersFile)) {
        const customersData = await fs.readJson(this.customersFile);
        this.customers = new Map(Object.entries(customersData));
      }

      console.log(`Loaded ${this.documents.size} documents, ${this.chunks.size} chunks, ${this.customers.size} customers`);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }

  /**
   * Save data to storage files
   */
  async saveData() {
    try {
      await Promise.all([
        fs.writeJson(this.documentsFile, Object.fromEntries(this.documents)),
        fs.writeJson(this.chunksFile, Object.fromEntries(this.chunks)),
        fs.writeJson(this.customersFile, Object.fromEntries(this.customers))
      ]);
    } catch (error) {
      console.error('Error saving data:', error);
      throw error;
    }
  }

  /**
   * Add or update customer information
   * @param {string} customerId - Customer ID
   * @param {Object} customerData - Customer data
   */
  async addCustomer(customerId, customerData) {
    const customer = {
      id: customerId,
      ...customerData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      documentIds: this.customers.get(customerId)?.documentIds || []
    };

    this.customers.set(customerId, customer);
    await this.saveData();
    return customer;
  }

  /**
   * Get customer information
   * @param {string} customerId - Customer ID
   * @returns {Object|null} - Customer data or null if not found
   */
  getCustomer(customerId) {
    return this.customers.get(customerId) || null;
  }

  /**
   * Add a document to the vector store
   * @param {string} customerId - Customer ID
   * @param {string} filename - Document filename
   * @param {string} content - Document content
   * @param {Object} metadata - Document metadata
   * @returns {Promise<string>} - Document ID
   */
  async addDocument(customerId, filename, content, metadata = {}) {
    const documentId = uuidv4();
    const document = {
      id: documentId,
      customerId,
      filename,
      content,
      metadata: {
        ...metadata,
        createdAt: new Date().toISOString(),
        fileSize: content.length
      },
      chunkIds: []
    };

    this.documents.set(documentId, document);

    // Update customer's document list
    const customer = this.customers.get(customerId);
    if (customer) {
      customer.documentIds.push(documentId);
      customer.updatedAt = new Date().toISOString();
      this.customers.set(customerId, customer);
    }

    await this.saveData();
    return documentId;
  }

  /**
   * Add chunks with embeddings to the vector store
   * @param {Array<Object>} chunks - Array of chunks with embeddings
   * @returns {Promise<Array<string>>} - Array of chunk IDs
   */
  async addChunks(chunks) {
    const chunkIds = [];

    for (const chunk of chunks) {
      const chunkId = chunk.id || uuidv4();
      const chunkData = {
        ...chunk,
        id: chunkId,
        createdAt: new Date().toISOString()
      };

      this.chunks.set(chunkId, chunkData);
      chunkIds.push(chunkId);

      // Update document's chunk list
      const document = this.documents.get(chunk.documentId);
      if (document) {
        document.chunkIds.push(chunkId);
      }
    }

    await this.saveData();
    return chunkIds;
  }

  /**
   * Get all chunks for a customer
   * @param {string} customerId - Customer ID
   * @returns {Array<Object>} - Array of chunks
   */
  getCustomerChunks(customerId) {
    const chunks = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.customerId === customerId) {
        chunks.push(chunk);
      }
    }
    return chunks;
  }

  /**
   * Get all chunks for a document
   * @param {string} documentId - Document ID
   * @returns {Array<Object>} - Array of chunks
   */
  getDocumentChunks(documentId) {
    const chunks = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.documentId === documentId) {
        chunks.push(chunk);
      }
    }
    return chunks;
  }

  /**
   * Get document by ID
   * @param {string} documentId - Document ID
   * @returns {Object|null} - Document data or null if not found
   */
  getDocument(documentId) {
    return this.documents.get(documentId) || null;
  }

  /**
   * Get all documents for a customer
   * @param {string} customerId - Customer ID
   * @returns {Array<Object>} - Array of documents
   */
  getCustomerDocuments(customerId) {
    const documents = [];
    for (const document of this.documents.values()) {
      if (document.customerId === customerId) {
        documents.push(document);
      }
    }
    return documents;
  }

  /**
   * Delete a document and its chunks
   * @param {string} documentId - Document ID
   * @returns {Promise<boolean>} - Success status
   */
  async deleteDocument(documentId) {
    try {
      const document = this.documents.get(documentId);
      if (!document) {
        return false;
      }

      // Delete associated chunks
      for (const chunkId of document.chunkIds) {
        this.chunks.delete(chunkId);
      }

      // Remove document from customer's list
      const customer = this.customers.get(document.customerId);
      if (customer) {
        customer.documentIds = customer.documentIds.filter(id => id !== documentId);
        customer.updatedAt = new Date().toISOString();
        this.customers.set(document.customerId, customer);
      }

      // Delete document
      this.documents.delete(documentId);

      await this.saveData();
      return true;
    } catch (error) {
      console.error('Error deleting document:', error);
      throw error;
    }
  }

  /**
   * Search for similar chunks across all customer documents
   * @param {string} customerId - Customer ID
   * @param {Array<number>} queryVector - Query vector
   * @param {number} topK - Number of top results to return
   * @param {number} threshold - Similarity threshold
   * @returns {Array<Object>} - Array of similar chunks with similarity scores
   */
  searchSimilarChunks(customerId, queryVector, topK = 5, threshold = 0.5) {
    const customerChunks = this.getCustomerChunks(customerId);
    
    if (customerChunks.length === 0) {
      return [];
    }

    const similarities = customerChunks.map(chunk => {
      const similarity = this.calculateCosineSimilarity(queryVector, chunk.embedding);
      return {
        ...chunk,
        similarity
      };
    });

    return similarities
      .filter(chunk => chunk.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  /**
   * Calculate cosine similarity between two vectors
   * @param {Array<number>} vectorA - First vector
   * @param {Array<number>} vectorB - Second vector
   * @returns {number} - Cosine similarity score (0-1)
   */
  calculateCosineSimilarity(vectorA, vectorB) {
    if (!vectorA || !vectorB || vectorA.length !== vectorB.length) {
      return 0;
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
   * Get storage statistics
   * @returns {Object} - Storage statistics
   */
  getStats() {
    return {
      customers: this.customers.size,
      documents: this.documents.size,
      chunks: this.chunks.size,
      storageDir: this.storageDir
    };
  }
}

module.exports = VectorStore;
