const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');

// Import constants
const CONFIG = require('./config/constants');

// Import services and routes
const CustomerService = require('./src/services/customerService');
const customersRouter = require('./src/routes/customers');
const adminRouter = require('./src/routes/admin');
const webhookRouter = require('./src/routes/webhook');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Configuration
const config = {
  googleAiApiKey: CONFIG.GOOGLE_AI_API_KEY,
  storageDir: CONFIG.STORAGE_DIR,
  uploadDir: CONFIG.UPLOAD_DIR,
  port: CONFIG.PORT,
  nodeEnv: CONFIG.NODE_ENV,
  // Simplified embedding configuration
  embeddingConfig: {
    textModel: CONFIG.EMBEDDING_CONFIG.TEXT_MODEL,
    multimodalModel: CONFIG.EMBEDDING_CONFIG.MULTIMODAL_MODEL
  }
};

// Validate required configuration
if (!config.googleAiApiKey) {
  console.error('Error: GOOGLE_AI_API_KEY is required in config/constants.js');
  process.exit(1);
}

// Initialize services
let customerService;

async function initializeServices() {
  try {
    console.log('Initializing services...');
    
    // Ensure required directories exist
    await fs.ensureDir(config.storageDir);
    await fs.ensureDir(config.uploadDir);
    
    // Initialize customer service
    customerService = new CustomerService(config);
    await customerService.initialize();
    
    // Make customer service available to routes
    app.set('customerService', customerService);
    
    console.log('Services initialized successfully');
  } catch (error) {
    console.error('Error initializing services:', error);
    process.exit(1);
  }
}

// Routes
app.use('/api/customers', customersRouter);
app.use('/api/admin', adminRouter);
app.use('/api/webhook', webhookRouter);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Gemini RAG System API',
    version: '1.0.0',
    status: 'operational',
    endpoints: {
      customers: '/api/customers/:customerId',
      documents: '/api/customers/:customerId/documents',
      query: '/api/customers/:customerId/query',
      summary: '/api/customers/:customerId/summary',
      suggestedQuestions: '/api/customers/:customerId/suggested-questions',
      admin: '/api/admin',
      health: '/api/admin/health',
      webhook: '/api/webhook/dialogflow',
      webhookHealth: '/api/webhook/health'
    },
    documentation: {
      upload: 'POST /api/customers/:customerId/documents - Upload policy documents',
      query: 'POST /api/customers/:customerId/query - Query policy information',
      summary: 'GET /api/customers/:customerId/summary - Get policy summary',
      health: 'GET /api/admin/health - System health check',
      dialogflow: 'POST /api/webhook/dialogflow - Dialogflow webhook integration (uses customer 9830323302)'
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    config: {
      nodeEnv: config.nodeEnv,
      port: config.port
    }
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: 'File too large',
      message: 'The uploaded file exceeds the maximum size limit'
    });
  }
  
  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      error: 'Invalid file upload',
      message: 'Unexpected file field or multiple files not allowed'
    });
  }
  
  res.status(500).json({
    error: 'Internal server error',
    message: config.nodeEnv === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: 'The requested endpoint does not exist',
    path: req.originalUrl
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

// Start server
async function startServer() {
  try {
    await initializeServices();
    
    app.listen(config.port, () => {
      console.log(`🚀 Gemini RAG System server running on port ${config.port}`);
      console.log(`📊 Environment: ${config.nodeEnv}`);
      console.log(`📁 Storage directory: ${config.storageDir}`);
      console.log(`📤 Upload directory: ${config.uploadDir}`);
      console.log(`🌐 API Base URL: http://localhost:${config.port}`);
      console.log(`📖 API Documentation: http://localhost:${config.port}`);
      console.log(`❤️  Health Check: http://localhost:${config.port}/health`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
