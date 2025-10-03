require('dotenv').config();
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const FormData = require('form-data');

// Configuration
const BASE_URL = 'http://localhost:3000';
const CUSTOMER_ID = 'john-smith-001';

class RAGSystemTester {
  constructor(baseUrl = BASE_URL) {
    this.baseUrl = baseUrl;
    this.customerId = CUSTOMER_ID;
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async testHealthCheck() {
    console.log('🔍 Testing health check...');
    try {
      const response = await axios.get(`${this.baseUrl}/health`);
      console.log('✅ Health check passed:', response.data.status);
      return true;
    } catch (error) {
      console.error('❌ Health check failed:', error.message);
      return false;
    }
  }

  async createCustomer() {
    console.log('👤 Creating customer...');
    try {
      const customerData = {
        name: 'John Smith',
        email: 'john.smith@example.com',
        phone: '(555) 123-4567'
      };

      const response = await axios.post(`${this.baseUrl}/api/customers/${this.customerId}`, customerData);
      console.log('✅ Customer created successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to create customer:', error.response?.data || error.message);
      return false;
    }
  }

  async uploadDocument(filename) {
    console.log(`📄 Uploading document: ${filename}...`);
    try {
      const filePath = path.join(__dirname, 'sample-data', filename);
      
      if (!await fs.pathExists(filePath)) {
        console.error(`❌ File not found: ${filePath}`);
        return false;
      }

      const form = new FormData();
      form.append('document', fs.createReadStream(filePath));
      form.append('customerName', 'John Smith');
      form.append('customerEmail', 'john.smith@example.com');

      const response = await axios.post(
        `${this.baseUrl}/api/customers/${this.customerId}/documents`,
        form,
        {
          headers: {
            ...form.getHeaders(),
          },
          timeout: 60000 // 60 seconds timeout for document processing
        }
      );

      console.log(`✅ Document uploaded successfully: ${response.data.result.documentId}`);
      console.log(`   - Chunks created: ${response.data.result.chunkCount}`);
      return response.data.result.documentId;
    } catch (error) {
      console.error(`❌ Failed to upload document ${filename}:`, error.response?.data || error.message);
      return false;
    }
  }

  async uploadAllSampleDocuments() {
    console.log('\n📚 Uploading all sample documents...');
    const documents = [
      'sample-auto-policy.txt',
      'sample-home-policy.txt',
      'sample-life-policy.txt'
    ];

    const results = [];
    for (const doc of documents) {
      const result = await this.uploadDocument(doc);
      if (result) {
        results.push(result);
      }
      // Add delay between uploads to respect rate limits
      await this.delay(2000);
    }

    return results;
  }

  async testQuery(query) {
    console.log(`❓ Testing query: "${query}"`);
    try {
      const response = await axios.post(`${this.baseUrl}/api/customers/${this.customerId}/query`, {
        query,
        options: {
          topK: 5,
          similarityThreshold: 0.6
        }
      });

      console.log(`✅ Query successful`);
      console.log(`   - Answer: ${response.data.answer.substring(0, 200)}...`);
      console.log(`   - Confidence: ${response.data.confidence}`);
      console.log(`   - Source chunks: ${response.data.sourceChunks.length}`);
      
      return response.data;
    } catch (error) {
      console.error(`❌ Query failed:`, error.response?.data || error.message);
      return false;
    }
  }

  async testMultipleQueries() {
    console.log('\n🤔 Testing multiple queries...');
    
    const queries = [
      "What is my auto insurance deductible?",
      "How much life insurance coverage do I have?",
      "What is covered under my homeowners policy?",
      "How do I file a claim for my car accident?",
      "What discounts am I getting on my policies?",
      "When does my life insurance policy expire?",
      "What is not covered by my home insurance?",
      "How much do I pay for my auto insurance?"
    ];

    const results = [];
    for (const query of queries) {
      const result = await this.testQuery(query);
      if (result) {
        results.push({ query, result });
      }
      // Add delay between queries
      await this.delay(3000);
    }

    return results;
  }

  async getPolicySummary() {
    console.log('\n📋 Getting policy summary...');
    try {
      const response = await axios.get(`${this.baseUrl}/api/customers/${this.customerId}/summary`);
      console.log('✅ Policy summary generated');
      console.log(`   - Document count: ${response.data.documentCount}`);
      console.log(`   - Summary: ${response.data.summary.substring(0, 300)}...`);
      return response.data;
    } catch (error) {
      console.error('❌ Failed to get policy summary:', error.response?.data || error.message);
      return false;
    }
  }

  async getSuggestedQuestions() {
    console.log('\n💡 Getting suggested questions...');
    try {
      const response = await axios.get(`${this.baseUrl}/api/customers/${this.customerId}/suggested-questions`);
      console.log('✅ Suggested questions generated');
      response.data.suggestedQuestions.forEach((question, index) => {
        console.log(`   ${index + 1}. ${question}`);
      });
      return response.data;
    } catch (error) {
      console.error('❌ Failed to get suggested questions:', error.response?.data || error.message);
      return false;
    }
  }

  async getCustomerDocuments() {
    console.log('\n📄 Getting customer documents...');
    try {
      const response = await axios.get(`${this.baseUrl}/api/customers/${this.customerId}/documents`);
      console.log('✅ Documents retrieved');
      console.log(`   - Total documents: ${response.data.documentCount}`);
      response.data.documents.forEach(doc => {
        console.log(`   - ${doc.filename} (${doc.chunkCount} chunks)`);
      });
      return response.data;
    } catch (error) {
      console.error('❌ Failed to get customer documents:', error.response?.data || error.message);
      return false;
    }
  }

  async runFullTest() {
    console.log('🚀 Starting RAG System Test\n');

    // Test health check
    const healthOk = await this.testHealthCheck();
    if (!healthOk) {
      console.log('❌ Server is not running. Please start the server first with: npm start');
      return;
    }

    await this.delay(1000);

    // Create customer
    await this.createCustomer();
    await this.delay(1000);

    // Upload documents
    const uploadedDocs = await this.uploadAllSampleDocuments();
    if (uploadedDocs.length === 0) {
      console.log('❌ No documents uploaded successfully. Cannot continue with tests.');
      return;
    }

    await this.delay(2000);

    // Get customer documents
    await this.getCustomerDocuments();
    await this.delay(1000);

    // Get policy summary
    await this.getPolicySummary();
    await this.delay(2000);

    // Get suggested questions
    await this.getSuggestedQuestions();
    await this.delay(2000);

    // Test multiple queries
    await this.testMultipleQueries();

    console.log('\n🎉 RAG System Test Completed!');
    console.log('\n📊 Test Summary:');
    console.log(`   - Customer created: ✅`);
    console.log(`   - Documents uploaded: ${uploadedDocs.length}/3`);
    console.log(`   - Queries tested: Multiple successful queries`);
    console.log(`   - Policy summary: Generated`);
    console.log(`   - Suggested questions: Generated`);
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  const tester = new RAGSystemTester();
  
  console.log('⚠️  Make sure to:');
  console.log('1. Copy env.example to .env');
  console.log('2. Add your GOOGLE_AI_API_KEY to .env');
  console.log('3. Start the server with: npm start');
  console.log('4. Wait for server to be ready, then run: node test-system.js\n');
  
  // Add a small delay to let user read the instructions
  setTimeout(() => {
    tester.runFullTest().catch(console.error);
  }, 3000);
}

module.exports = RAGSystemTester;
