/**
 * Application Configuration Constants
 * All configuration values are centralized here instead of using .env
 */

module.exports = {
  // Google AI API Key for Gemini
  //  GOOGLE_AI_API_KEY='AIzaSyAX0NQ2c3kjfVnv9Iip2lbaN6YoqsjQCC8'
  GOOGLE_AI_API_KEY:'AIzaSyC_xetiYQJAQsqMzOE-yj_Zp_zlx3nRnR4',
  // #GOOGLE_AI_API_KEY='AIzaSyDtFEEOyL0IpqZCV_Dl-3f2fCHKiSZTpkk'

  
  // Server Configuration
  PORT: 3000,
  NODE_ENV: 'development',
  
  // File Upload Configuration
  MAX_FILE_SIZE: 10485760, // 10MB in bytes
  UPLOAD_DIR: './uploads',
  
  // Storage Configuration
  STORAGE_DIR: './data',
  
  // Vector Database Configuration
  VECTOR_DIMENSION: 768,
  SIMILARITY_THRESHOLD: 0.4,
  
  // Embedding Configuration
  // Uses text-embedding-004 for text embeddings and gemini-1.5-pro for multimodal content
  EMBEDDING_CONFIG: {
    TEXT_MODEL: 'text-embedding-004',
    MULTIMODAL_MODEL: 'gemini-1.5-pro'
  },
  
  // Dialogflow Configuration
  DEFAULT_CUSTOMER_ID: '9830323302'
};

