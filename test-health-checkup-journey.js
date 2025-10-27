const HealthCheckupJourneyService = require('./src/services/healthCheckupJourneyService');
const GeminiService = require('./src/services/geminiService');
const HospitalService = require('./src/services/hospitalService');

async function testHealthCheckupJourney() {
    console.log('🏥 Testing Health Checkup Journey Service...\n');

    try {
        // Initialize services
        const geminiService = new GeminiService();
        const hospitalService = new HospitalService();
        const healthCheckupService = new HealthCheckupJourneyService(geminiService, hospitalService);

        // Test 1: Initial greeting
        console.log('📝 Test 1: Initial greeting');
        const result1 = await healthCheckupService.processHealthCheckupQuery(
            '9830323302',
            'I want to book a health checkup',
            { conversationId: 'test-health-checkup-1' }
        );
        console.log('Response:', result1.answer);
        console.log('Conversation ID:', result1.conversationId);
        console.log('Intent:', result1.intent);
        console.log('---\n');

        // Test 2: Package selection
        console.log('📝 Test 2: Package selection');
        const result2 = await healthCheckupService.processHealthCheckupQuery(
            '9830323302',
            'Yes, I want to proceed with the health checkup package',
            { conversationId: result1.conversationId }
        );
        console.log('Response:', result2.answer);
        console.log('---\n');

        // Test 3: Scheduling details
        console.log('📝 Test 3: Scheduling details');
        const result3 = await healthCheckupService.processHealthCheckupQuery(
            '9830323302',
            'I want to schedule it for tomorrow at 10 AM',
            { conversationId: result1.conversationId }
        );
        console.log('Response:', result3.answer);
        console.log('---\n');

        console.log('✅ Health Checkup Journey tests completed successfully!');

    } catch (error) {
        console.error('❌ Error testing health checkup journey:', error);
    }
}

// Run the test
testHealthCheckupJourney();
