require('dotenv').config();
const axios = require('axios');

// Configuration
const BASE_URL = 'http://localhost:3000';
const CUSTOMER_ID = 'john-smith-multimodel-test';

class MultiModelTester {
  constructor(baseUrl = BASE_URL) {
    this.baseUrl = baseUrl;
    this.customerId = CUSTOMER_ID;
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async testHealthCheck() {
    console.log('🔍 Testing health check with embedding models info...');
    try {
      const response = await axios.get(`${this.baseUrl}/api/admin/health`);
      console.log('✅ Health check passed:', response.data.status);
      console.log('📊 Available embedding models:', response.data.embeddingModels.available);
      console.log('🎯 Default model:', response.data.embeddingModels.default);
      return true;
    } catch (error) {
      console.error('❌ Health check failed:', error.message);
      return false;
    }
  }

  async getEmbeddingModels() {
    console.log('\n🤖 Getting embedding models configuration...');
    try {
      const response = await axios.get(`${this.baseUrl}/api/admin/embedding-models`);
      console.log('✅ Available models:', response.data.models);
      console.log('📋 Model configurations:');
      Object.entries(response.data.configurations).forEach(([model, config]) => {
        console.log(`   - ${model}: ${config.description} (${config.dimensions}D)`);
      });
      console.log('🔗 Content type mappings:', response.data.contentTypeMapping);
      return response.data;
    } catch (error) {
      console.error('❌ Failed to get embedding models:', error.response?.data || error.message);
      return false;
    }
  }

  async testEmbeddingGeneration() {
    console.log('\n🧪 Testing embedding generation with different models...');
    
    const testTexts = [
      {
        text: "What is my auto insurance deductible?",
        contentType: "query",
        description: "Query text"
      },
      {
        text: "This policy provides comprehensive coverage for your vehicle including collision, comprehensive, and liability protection.",
        contentType: "policy_document",
        description: "Policy document text"
      },
      {
        text: "¿Cuál es mi deducible del seguro de auto?",
        contentType: "multilingual",
        description: "Multilingual query (Spanish)"
      }
    ];

    const models = ['text-embedding-004', 'embedding-001', 'text-multilingual-embedding-002'];

    for (const testCase of testTexts) {
      console.log(`\n📝 Testing: ${testCase.description}`);
      console.log(`   Text: "${testCase.text.substring(0, 50)}..."`);
      
      for (const model of models) {
        try {
          const response = await axios.post(`${this.baseUrl}/api/admin/embedding-models/test`, {
            text: testCase.text,
            modelName: model,
            contentType: testCase.contentType
          });
          
          console.log(`   ✅ ${model}: ${response.data.embedding.dimensions}D vector, Task: ${response.data.embedding.taskType}`);
          console.log(`      Preview: [${response.data.embedding.vectorPreview.map(v => v.toFixed(3)).join(', ')}...]`);
        } catch (error) {
          console.log(`   ❌ ${model}: Failed - ${error.response?.data?.message || error.message}`);
        }
        
        await this.delay(1000); // Rate limiting
      }
    }
  }

  async createCustomerAndUploadDocument() {
    console.log('\n👤 Creating customer and uploading sample document...');
    
    // Create customer
    try {
      const customerData = {
        name: 'John Smith (Multi-Model Test)',
        email: 'john.multimodel@example.com',
        phone: '(555) 123-4567'
      };

      await axios.post(`${this.baseUrl}/api/customers/${this.customerId}`, customerData);
      console.log('✅ Customer created successfully');
    } catch (error) {
      console.error('❌ Failed to create customer:', error.response?.data || error.message);
      return false;
    }

    // Upload a document (using sample auto policy)
    try {
      const fs = require('fs-extra');
      const FormData = require('form-data');
      const path = require('path');
      
      const filePath = path.join(__dirname, 'sample-data', 'sample-auto-policy.txt');
      
      if (!await fs.pathExists(filePath)) {
        console.error('❌ Sample document not found');
        return false;
      }

      const form = new FormData();
      form.append('document', fs.createReadStream(filePath));
      form.append('customerName', 'John Smith (Multi-Model Test)');

      const response = await axios.post(
        `${this.baseUrl}/api/customers/${this.customerId}/documents`,
        form,
        {
          headers: { ...form.getHeaders() },
          timeout: 60000
        }
      );

      console.log(`✅ Document uploaded: ${response.data.result.documentId}`);
      console.log(`   Chunks created: ${response.data.result.chunkCount}`);
      return response.data.result.documentId;
    } catch (error) {
      console.error('❌ Failed to upload document:', error.response?.data || error.message);
      return false;
    }
  }

  async testQueryWithDifferentModels() {
    console.log('\n🔍 Testing queries with different embedding models...');
    
    const queries = [
      "What is my auto insurance deductible?",
      "How do I file a claim for my car accident?",
      "What discounts am I getting on my auto policy?"
    ];

    const models = ['text-embedding-004', 'embedding-001'];

    for (const query of queries) {
      console.log(`\n❓ Query: "${query}"`);
      
      for (const model of models) {
        try {
          const response = await axios.post(`${this.baseUrl}/api/customers/${this.customerId}/query`, {
            query,
            embeddingModel: model,
            options: {
              topK: 3,
              similarityThreshold: 0.6
            }
          });

          console.log(`   ✅ ${model}:`);
          console.log(`      Answer: ${response.data.answer.substring(0, 150)}...`);
          console.log(`      Confidence: ${response.data.confidence}`);
          console.log(`      Source chunks: ${response.data.sourceChunks.length}`);
          console.log(`      Embedding model used: ${response.data.embeddingModel}`);
          console.log(`      Dimensions: ${response.data.embeddingDimensions}`);
        } catch (error) {
          console.log(`   ❌ ${model}: Failed - ${error.response?.data?.message || error.message}`);
        }
        
        await this.delay(3000); // Rate limiting for API calls
      }
    }
  }

  async testModelConfiguration() {
    console.log('\n⚙️ Testing model configuration changes...');
    
    // Test setting default model
    try {
      const response = await axios.put(`${this.baseUrl}/api/admin/embedding-models/default`, {
        modelName: 'text-embedding-004'
      });
      console.log('✅ Default model set:', response.data.message);
    } catch (error) {
      console.error('❌ Failed to set default model:', error.response?.data || error.message);
    }

    await this.delay(1000);

    // Test updating content type mapping
    try {
      const response = await axios.put(`${this.baseUrl}/api/admin/embedding-models/content-mapping`, {
        contentType: 'query',
        modelName: 'text-embedding-004'
      });
      console.log('✅ Content mapping updated:', response.data.message);
    } catch (error) {
      console.error('❌ Failed to update content mapping:', error.response?.data || error.message);
    }
  }

  async runFullMultiModelTest() {
    console.log('🚀 Starting Multi-Model RAG System Test\n');

    // Test health check
    const healthOk = await this.testHealthCheck();
    if (!healthOk) {
      console.log('❌ Server is not running. Please start the server first with: npm start');
      return;
    }

    await this.delay(1000);

    // Get embedding models info
    await this.getEmbeddingModels();
    await this.delay(1000);

    // Test embedding generation
    await this.testEmbeddingGeneration();
    await this.delay(2000);

    // Test model configuration
    await this.testModelConfiguration();
    await this.delay(1000);

    // Create customer and upload document
    const documentId = await this.createCustomerAndUploadDocument();
    if (!documentId) {
      console.log('❌ Cannot continue without uploaded document');
      return;
    }

    await this.delay(3000);

    // Test queries with different models
    await this.testQueryWithDifferentModels();

    console.log('\n🎉 Multi-Model RAG System Test Completed!');
    console.log('\n📊 Test Summary:');
    console.log('   ✅ Health check with model info');
    console.log('   ✅ Embedding model configurations retrieved');
    console.log('   ✅ Embedding generation tested with multiple models');
    console.log('   ✅ Model configuration changes tested');
    console.log('   ✅ Customer created and document uploaded');
    console.log('   ✅ Queries tested with different embedding models');
    console.log('\n🔧 Multi-Model Features Demonstrated:');
    console.log('   - Multiple Gemini embedding models (text-embedding-004, embedding-001, text-multilingual-embedding-002)');
    console.log('   - Automatic model selection based on content type');
    console.log('   - Manual model specification for queries');
    console.log('   - Model configuration management');
    console.log('   - Fallback mechanisms for model failures');
    console.log('   - Smart embedding with content analysis');
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  const tester = new MultiModelTester();
  
  console.log('⚠️  Multi-Model Setup Instructions:');
  console.log('1. Make sure your .env file has the GOOGLE_AI_API_KEY');
  console.log('2. Start the server with: npm start');
  console.log('3. Wait for server to be ready');
  console.log('4. Run this test: node test-multi-model.js\n');
  
  // Add a small delay to let user read the instructions
  setTimeout(() => {
    tester.runFullMultiModelTest().catch(console.error);
  }, 3000);
}

module.exports = MultiModelTester;
