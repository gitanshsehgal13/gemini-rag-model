const axios = require('axios');

/**
 * Test script for Intent-Based Journey
 */

const BASE_URL = 'http://localhost:3000';
const CUSTOMER_ID = '9988676666';

class IntentJourneyTester {
  constructor(baseUrl = BASE_URL, customerId = CUSTOMER_ID) {
    this.baseUrl = baseUrl;
    this.customerId = customerId;
  }

  /**
   * Test intent-based journey conversation
   */
  async testIntentJourney() {
    console.log('🚀 Testing Intent-Based Journey\n');
    console.log('='.repeat(60));

    // Conversation flow for EVENT_DRIVEN_CLAIM_EPISODE intent
    const conversationFlow = [
      {
        message: "I need to find a hospital near me",
        description: "Initial query - customer looking for hospital"
      },
      {
        message: "Yes, I need admission",
        description: "Customer confirms need for admission"
      },
      {
        message: "I'm looking for myself",
        description: "Customer looking for themselves"
      },
      {
        message: "I have chest pain and breathing issues",
        description: "Customer describes medical issue"
      },
      {
        message: "Can you show me hospitals in Andheri?",
        description: "Customer asks for specific location"
      }
    ];

    for (let i = 0; i < conversationFlow.length; i++) {
      const { message, description } = conversationFlow[i];
      
      console.log(`\n📱 Step ${i + 1}: ${description}`);
      console.log(`   Customer: "${message}"`);
      
      try {
        const response = await this.sendQuery(message);
        
        console.log(`\n   ✅ Response received:`);
        console.log(`   Agent: "${response.answer}"`);
        console.log(`   Conversation ID: ${response.conversationId}`);
        console.log(`   Intent: ${response.intent}`);
        console.log(`   History Length: ${response.conversationHistory?.length || 0} messages`);
        
        // Wait a bit before next message
        await this.delay(2000);
        
      } catch (error) {
        console.error(`\n   ❌ Error:`, error.response?.data || error.message);
        break;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✨ Intent Journey Test Completed!\n');
  }

  /**
   * Send a query with intent
   */
  async sendQuery(message) {
    const response = await axios.post(
      `${this.baseUrl}/api/customers/${this.customerId}/query`,
      {
        query: message,
        intent: "EVENT_DRIVEN_CLAIM_EPISODE",
        options: {
          communicationMode: "WHATSAPP"
        }
      }
    );

    return response.data;
  }

  /**
   * Test single query with intent
   */
  async testSingleQuery(message) {
    console.log('\n🔍 Testing Single Query with Intent\n');
    console.log('='.repeat(60));
    console.log(`\nCustomer: "${message}"`);

    try {
      const response = await this.sendQuery(message);
      
      console.log(`\n✅ Response received:`);
      console.log(`Agent: "${response.answer}"`);
      console.log(`\nFull Response:`, JSON.stringify(response, null, 2));
      
    } catch (error) {
      console.error(`\n❌ Error:`, error.response?.data || error.message);
    }

    console.log('\n' + '='.repeat(60));
  }

  /**
   * Delay helper
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run tests
async function runTests() {
  const tester = new IntentJourneyTester();
  
  const args = process.argv.slice(2);
  
  if (args[0] === 'single') {
    // Test single query
    const message = args[1] || "I need to find a hospital";
    await tester.testSingleQuery(message);
  } else {
    // Test full conversation flow
    await tester.testIntentJourney();
  }
}

if (require.main === module) {
  runTests().catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
}

module.exports = IntentJourneyTester;

