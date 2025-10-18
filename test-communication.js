const CommunicationService = require('./src/services/communicationService');

/**
 * Test script for Communication Service
 */

async function runTests() {
  // Create an instance of the service
  const communicationService = new CommunicationService();

  // Test the sendMessage function
  console.log('🚀 Testing Communication Service\n');
  console.log('='.repeat(60));

  // Test 1: Send message with default text
  console.log('\n📱 Test 1: Send message with default text');
  const result1 = await communicationService.sendMessage('I want my policy summary');
  console.log('Result:', result1.success ? '✅ Success' : '❌ Failed');
  console.log('\n');

  // Test 2: Send message with custom text
  console.log('\n📱 Test 2: Send message with custom text');
  const result2 = await communicationService.sendMessage('What is my premium amount?');
  console.log('Result:', result2.success ? '✅ Success' : '❌ Failed');
  console.log('\n');

  console.log('='.repeat(60));
  console.log('✨ Tests completed!\n');
}

// Run the tests
runTests().catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});

