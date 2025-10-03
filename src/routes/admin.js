const express = require('express');
const router = express.Router();

/**
 * GET /api/admin/stats
 * Get system statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const customerService = req.app.get('customerService');
    const stats = customerService.getStats();
    
    res.json({
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/search
 * Search across all documents (admin function)
 */
router.post('/search', async (req, res) => {
  try {
    const { query, options = {} } = req.body;
    const customerService = req.app.get('customerService');
    
    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        error: 'Query is required and must be a string'
      });
    }

    const results = await customerService.searchAllDocuments(query, options);
    
    res.json({
      query,
      resultCount: results.length,
      results: results.map(result => ({
        customerId: result.customerId,
        documentId: result.documentId,
        chunkId: result.id,
        similarity: result.similarity,
        text: result.text.substring(0, 200) + '...'
      }))
    });
  } catch (error) {
    console.error('Error searching documents:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/test-embedding
 * Test embedding generation
 */
router.post('/test-embedding', async (req, res) => {
  try {
    const { text } = req.body;
    const customerService = req.app.get('customerService');
    
    if (!text) {
      return res.status(400).json({
        error: 'Text is required for embedding test'
      });
    }
    
    const embeddingResult = await customerService.embeddingService.generateEmbedding(text);
    
    res.json({
      text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
      embedding: {
        model: embeddingResult.model,
        dimensions: embeddingResult.dimensions,
        vectorPreview: embeddingResult.values.slice(0, 10) // First 10 dimensions
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error testing embedding:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/test-multimodal
 * Test multimodal embedding generation
 */
router.post('/test-multimodal', async (req, res) => {
  try {
    const { text, images } = req.body;
    const customerService = req.app.get('customerService');
    
    if (!text && (!images || images.length === 0)) {
      return res.status(400).json({
        error: 'Text or images are required for multimodal test'
      });
    }
    
    const content = { text: text || '', images: images || [] };
    const embeddingResult = await customerService.embeddingService.generateMultimodalEmbedding(content);
    
    res.json({
      content: {
        text: (text || '').substring(0, 100) + (text && text.length > 100 ? '...' : ''),
        imageCount: images ? images.length : 0
      },
      embedding: {
        model: embeddingResult.model,
        dimensions: embeddingResult.dimensions,
        vectorPreview: embeddingResult.values.slice(0, 10),
        multimodalDescription: embeddingResult.multimodalDescription.substring(0, 200) + '...'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error testing multimodal embedding:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/health
 * Health check endpoint
 */
router.get('/health', async (req, res) => {
  try {
    const customerService = req.app.get('customerService');
    const stats = customerService.getStats();
    
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        vectorStore: 'operational',
        embeddingService: 'operational',
        geminiService: 'operational'
      },
      stats,
      models: {
        textEmbedding: 'text-embedding-004',
        multimodal: 'gemini-1.5-pro'
      }
    };
    
    res.json(health);
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

module.exports = router;
