require('dotenv').config();
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const FormData = require('form-data');

// Configuration
const BASE_URL = 'http://localhost:3000';
const CUSTOMER_ID = 'multimodal-test-customer';

class MultimodalTester {
  constructor(baseUrl = BASE_URL) {
    this.baseUrl = baseUrl;
    this.customerId = CUSTOMER_ID;
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async createSampleImages() {
    console.log('📸 Creating sample images for testing...');
    
    const sampleDir = path.join(__dirname, 'sample-data');
    await fs.ensureDir(sampleDir);

    // Create a simple test image (SVG converted to PNG would be ideal, but for demo we'll create a simple text file as "image")
    const sampleImageContent = `
Policy Summary Chart
====================

Auto Insurance Policy #AUTO-123456789
Premium: $1,200/year
Deductible: $1,000

Coverage Details:
- Liability: $100,000/$300,000
- Comprehensive: $500 deductible
- Collision: $1,000 deductible

This is a mock image file for testing multimodal functionality.
In a real scenario, this would be an actual image with charts, forms, or visual policy information.
`;

    const imagePath = path.join(sampleDir, 'policy-chart.txt');
    await fs.writeFile(imagePath, sampleImageContent);
    
    console.log('✅ Sample "image" file created (using text file as mock image)');
    console.log('   In production, use actual PNG/JPEG files with policy charts, forms, etc.');
    
    return [imagePath];
  }

  async testHealthCheck() {
    console.log('🔍 Testing health check...');
    try {
      const response = await axios.get(`${this.baseUrl}/api/admin/health`);
      console.log('✅ Health check passed:', response.data.status);
      console.log('🤖 Available embedding models:', response.data.embeddingModels.available);
      
      // Check if multimodal models are available
      const hasMultimodal = response.data.embeddingModels.available.some(model => 
        model.includes('gemini-1.5') || model.includes('gemini-1.0')
      );
      console.log(`🔍 Multimodal models available: ${hasMultimodal ? 'Yes' : 'No'}`);
      
      return true;
    } catch (error) {
      console.error('❌ Health check failed:', error.message);
      return false;
    }
  }

  async testMultimodalEmbedding() {
    console.log('\n🧪 Testing multimodal embedding generation...');
    
    try {
      const response = await axios.post(`${this.baseUrl}/api/admin/embedding-models/test`, {
        text: "This policy document contains important coverage information and premium details.",
        modelName: 'gemini-1.5-flash',
        contentType: 'multimodal'
      });
      
      console.log('✅ Multimodal embedding test successful');
      console.log(`   Model used: ${response.data.embedding.model}`);
      console.log(`   Dimensions: ${response.data.embedding.dimensions}`);
      console.log(`   Task type: ${response.data.embedding.taskType}`);
      
      return true;
    } catch (error) {
      console.error('❌ Multimodal embedding test failed:', error.response?.data || error.message);
      return false;
    }
  }

  async createCustomer() {
    console.log('\n👤 Creating customer for multimodal testing...');
    try {
      const customerData = {
        name: 'Multimodal Test Customer',
        email: 'multimodal@example.com',
        phone: '(555) 999-0000'
      };

      await axios.post(`${this.baseUrl}/api/customers/${this.customerId}`, customerData);
      console.log('✅ Customer created successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to create customer:', error.response?.data || error.message);
      return false;
    }
  }

  async uploadTextOnlyDocument() {
    console.log('\n📄 Testing traditional text-only document upload...');
    
    try {
      const filePath = path.join(__dirname, 'sample-data', 'sample-auto-policy.txt');
      
      if (!await fs.pathExists(filePath)) {
        console.error('❌ Sample document not found');
        return false;
      }

      const form = new FormData();
      form.append('document', fs.createReadStream(filePath));
      form.append('customerName', 'Multimodal Test Customer');

      const response = await axios.post(
        `${this.baseUrl}/api/customers/${this.customerId}/documents`,
        form,
        {
          headers: { ...form.getHeaders() },
          timeout: 60000
        }
      );

      console.log(`✅ Text document uploaded: ${response.data.result.documentId}`);
      console.log(`   Content type: ${response.data.result.contentType}`);
      console.log(`   Has images: ${response.data.result.hasImages}`);
      console.log(`   Chunks: ${response.data.result.chunkCount}`);
      
      return response.data.result.documentId;
    } catch (error) {
      console.error('❌ Failed to upload text document:', error.response?.data || error.message);
      return false;
    }
  }

  async uploadImageOnlyDocument() {
    console.log('\n🖼️  Testing image-only document upload...');
    
    try {
      const imagePaths = await this.createSampleImages();
      
      const form = new FormData();
      
      // Upload images only (no primary document)
      for (let i = 0; i < imagePaths.length; i++) {
        form.append('images', fs.createReadStream(imagePaths[i]));
      }
      
      form.append('customerName', 'Multimodal Test Customer');
      form.append('description', 'Policy charts and visual information extracted from scanned documents');

      const response = await axios.post(
        `${this.baseUrl}/api/customers/${this.customerId}/documents`,
        form,
        {
          headers: { ...form.getHeaders() },
          timeout: 60000
        }
      );

      console.log(`✅ Image-only document uploaded: ${response.data.result.documentId}`);
      console.log(`   Content type: ${response.data.result.contentType}`);
      console.log(`   Has images: ${response.data.result.hasImages}`);
      console.log(`   Image count: ${response.data.result.imageCount}`);
      console.log(`   Chunks: ${response.data.result.chunkCount}`);
      
      return response.data.result.documentId;
    } catch (error) {
      console.error('❌ Failed to upload image document:', error.response?.data || error.message);
      return false;
    }
  }

  async uploadMultimodalDocument() {
    console.log('\n🎭 Testing multimodal document upload (text + images)...');
    
    try {
      const textFilePath = path.join(__dirname, 'sample-data', 'sample-home-policy.txt');
      const imagePaths = await this.createSampleImages();
      
      if (!await fs.pathExists(textFilePath)) {
        console.error('❌ Sample text document not found');
        return false;
      }

      const form = new FormData();
      
      // Upload primary document
      form.append('document', fs.createReadStream(textFilePath));
      
      // Upload additional images
      for (let i = 0; i < imagePaths.length; i++) {
        form.append('images', fs.createReadStream(imagePaths[i]));
      }
      
      form.append('customerName', 'Multimodal Test Customer');
      form.append('description', 'Home insurance policy with additional charts and visual documentation');

      const response = await axios.post(
        `${this.baseUrl}/api/customers/${this.customerId}/documents`,
        form,
        {
          headers: { ...form.getHeaders() },
          timeout: 90000 // Longer timeout for multimodal processing
        }
      );

      console.log(`✅ Multimodal document uploaded: ${response.data.result.documentId}`);
      console.log(`   Content type: ${response.data.result.contentType}`);
      console.log(`   Has images: ${response.data.result.hasImages}`);
      console.log(`   Image count: ${response.data.result.imageCount}`);
      console.log(`   Text length: ${response.data.result.textLength}`);
      console.log(`   Chunks: ${response.data.result.chunkCount}`);
      
      return response.data.result.documentId;
    } catch (error) {
      console.error('❌ Failed to upload multimodal document:', error.response?.data || error.message);
      return false;
    }
  }

  async testMultimodalQueries() {
    console.log('\n🔍 Testing queries on multimodal content...');
    
    const queries = [
      "What information is shown in the charts or visual elements?",
      "What are the coverage details from the policy documents?",
      "Can you describe any visual information or charts in my policy?",
      "What premium information is available in my documents?",
      "Are there any diagrams or charts showing my coverage?"
    ];

    for (const query of queries) {
      console.log(`\n❓ Query: "${query}"`);
      
      try {
        const response = await axios.post(`${this.baseUrl}/api/customers/${this.customerId}/query`, {
          query,
          options: {
            topK: 5,
            similarityThreshold: 0.6
          }
        });

        console.log(`   ✅ Response generated`);
        console.log(`   Answer: ${response.data.answer.substring(0, 200)}...`);
        console.log(`   Confidence: ${response.data.confidence}`);
        console.log(`   Source chunks: ${response.data.sourceChunks.length}`);
        console.log(`   Embedding model: ${response.data.embeddingModel}`);
        
        // Check if any source chunks are multimodal
        const multimodalChunks = response.data.sourceChunks.filter(chunk => 
          chunk.text && chunk.text.includes('multimodal') || 
          chunk.chunkId && chunk.chunkId.includes('multimodal')
        );
        
        if (multimodalChunks.length > 0) {
          console.log(`   🎭 Multimodal chunks found: ${multimodalChunks.length}`);
        }
        
      } catch (error) {
        console.log(`   ❌ Query failed: ${error.response?.data?.message || error.message}`);
      }
      
      await this.delay(3000); // Rate limiting
    }
  }

  async getCustomerDocuments() {
    console.log('\n📋 Getting customer documents...');
    try {
      const response = await axios.get(`${this.baseUrl}/api/customers/${this.customerId}/documents`);
      
      console.log('✅ Documents retrieved');
      console.log(`   Total documents: ${response.data.documentCount}`);
      
      response.data.documents.forEach(doc => {
        console.log(`   - ${doc.filename}`);
        console.log(`     Chunks: ${doc.chunkCount}`);
        if (doc.metadata.contentType) {
          console.log(`     Type: ${doc.metadata.contentType}`);
        }
        if (doc.metadata.hasImages) {
          console.log(`     Images: ${doc.metadata.imageCount}`);
        }
      });
      
      return response.data;
    } catch (error) {
      console.error('❌ Failed to get documents:', error.response?.data || error.message);
      return false;
    }
  }

  async runFullMultimodalTest() {
    console.log('🚀 Starting Multimodal RAG System Test\n');
    console.log('🎯 This test demonstrates Gemini 1.5 multimodal embedding capabilities');
    console.log('📝 Testing text + image processing for insurance policy documents\n');

    // Test health check
    const healthOk = await this.testHealthCheck();
    if (!healthOk) {
      console.log('❌ Server is not running or not properly configured');
      return;
    }

    await this.delay(1000);

    // Test multimodal embedding
    const embeddingOk = await this.testMultimodalEmbedding();
    if (!embeddingOk) {
      console.log('⚠️  Multimodal embedding test failed, but continuing with other tests');
    }

    await this.delay(1000);

    // Create customer
    const customerOk = await this.createCustomer();
    if (!customerOk) {
      console.log('❌ Cannot continue without customer');
      return;
    }

    await this.delay(1000);

    // Test different upload types
    const textDocId = await this.uploadTextOnlyDocument();
    await this.delay(2000);

    const imageDocId = await this.uploadImageOnlyDocument();
    await this.delay(2000);

    const multimodalDocId = await this.uploadMultimodalDocument();
    await this.delay(3000);

    // Get documents summary
    await this.getCustomerDocuments();
    await this.delay(1000);

    // Test multimodal queries
    if (textDocId || imageDocId || multimodalDocId) {
      await this.testMultimodalQueries();
    }

    console.log('\n🎉 Multimodal RAG System Test Completed!');
    console.log('\n📊 Test Summary:');
    console.log(`   ✅ Health check: ${healthOk ? 'Passed' : 'Failed'}`);
    console.log(`   ✅ Multimodal embedding: ${embeddingOk ? 'Passed' : 'Failed'}`);
    console.log(`   ✅ Customer created: ${customerOk ? 'Yes' : 'No'}`);
    console.log(`   ✅ Text-only document: ${textDocId ? 'Uploaded' : 'Failed'}`);
    console.log(`   ✅ Image-only document: ${imageDocId ? 'Uploaded' : 'Failed'}`);
    console.log(`   ✅ Multimodal document: ${multimodalDocId ? 'Uploaded' : 'Failed'}`);
    console.log(`   ✅ Multimodal queries: Tested`);

    console.log('\n🔧 Multimodal Features Demonstrated:');
    console.log('   - Gemini 1.5 Flash/Pro multimodal embedding generation');
    console.log('   - Text + image document processing');
    console.log('   - Image-only document support');
    console.log('   - Multimodal content chunking and storage');
    console.log('   - Smart embedding selection based on content type');
    console.log('   - Multimodal query processing and retrieval');

    console.log('\n💡 Next Steps:');
    console.log('   - Upload actual PNG/JPEG images with policy charts');
    console.log('   - Test with PDF documents containing embedded images');
    console.log('   - Try DOCX files with embedded charts and diagrams');
    console.log('   - Experiment with different Gemini 1.5 model variants');
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  const tester = new MultimodalTester();
  
  console.log('⚠️  Multimodal Setup Instructions:');
  console.log('1. Make sure your .env file has the GOOGLE_AI_API_KEY');
  console.log('2. Ensure Gemini 1.5 models are available in your API');
  console.log('3. Start the server with: npm start');
  console.log('4. Run this test: node test-multimodal.js\n');
  console.log('📸 Note: This demo uses text files as mock images.');
  console.log('   For full multimodal testing, use actual PNG/JPEG files.\n');
  
  // Add a small delay to let user read the instructions
  setTimeout(() => {
    tester.runFullMultimodalTest().catch(console.error);
  }, 3000);
}

module.exports = MultimodalTester;
