const SchedulingAgent = require('./src/services/schedulingAgent');

/**
 * Test script for Scheduling Agent
 */

async function testSchedulingAgent() {
  console.log('🤖 Testing Scheduling Agent\n');
  console.log('='.repeat(60));

  const schedulingAgent = new SchedulingAgent();
  
  const conversationId = 'test-conversation-001';
  const customerId = '9830323302';

  // Test 1: Schedule hospital admission follow-ups
  console.log('\n📅 Test 1: Scheduling Hospital Admission Follow-ups\n');
  
  const result1 = schedulingAgent.scheduleIntentBasedFollowUps(
    conversationId,
    customerId,
    'hospital_admission_scheduled',
    {
      customerName: 'Vineet',
      hospitalName: 'Apollo Hospital',
      date: 'Monday, 10 AM'
    }
  );

  console.log('Scheduling Result:', JSON.stringify(result1, null, 2));

  // Test 2: Schedule custom messages
  console.log('\n📅 Test 2: Scheduling Custom Messages\n');
  
  const customMessages = [
    {
      text: 'Hi there! Just wanted to check in. How are you feeling today?',
      delayInSeconds: 5
    },
    {
      text: 'Remember to take your medication as prescribed by your doctor.',
      delayInSeconds: 5
    },
    {
      text: 'If you need anything, feel free to reach out. Take care! 💙',
      delayInSeconds: 5
    }
  ];

  const result2 = schedulingAgent.scheduleMessages(
    'test-conversation-002',
    customerId,
    customMessages
  );

  console.log('Custom Scheduling Result:', JSON.stringify(result2, null, 2));

  // Test 3: View scheduled messages
  console.log('\n📋 Test 3: Viewing Scheduled Messages\n');
  
  setTimeout(() => {
    const allMessages = schedulingAgent.getAllMessages(conversationId);
    console.log('All Messages for Conversation:', JSON.stringify(allMessages, null, 2));
  }, 3000);

  // Keep the process running to see scheduled messages execute
  console.log('\n⏳ Waiting for scheduled messages to execute...');
  console.log('(Messages will be sent at 10-second intervals)\n');

  // Wait for all messages to complete
  setTimeout(() => {
    console.log('\n' + '='.repeat(60));
    console.log('✨ Test completed! Check the logs above to see message execution.\n');
    process.exit(0);
  }, 60000); // Wait 60 seconds for all messages
}

// Run the test
testSchedulingAgent().catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});

