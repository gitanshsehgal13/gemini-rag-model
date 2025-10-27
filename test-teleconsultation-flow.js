const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const CUSTOMER_ID = '9830323302';

async function testTeleconsultationFlow() {
    console.log('🧪 Testing Tele-Consultation Flow After Scheduled Messages\n');
    
    const testSteps = [
        {
            step: 1,
            query: "Searching hospital",
            description: "Initial greeting and hospital search"
        },
        {
            step: 2,
            query: "my wife Punita",
            description: "Identify patient"
        },
        {
            step: 3,
            query: "hand fracture",
            description: "Medical reason"
        },
        {
            step: 4,
            query: "Seven Star Hospital",
            description: "Hospital selection"
        },
        {
            step: 5,
            query: "yes",
            description: "Confirm admission"
        },
        {
            step: 6,
            query: "20000",
            description: "Estimated cost"
        },
        {
            step: 7,
            query: "25 October 10:00 AM",
            description: "Admission date and time - should trigger claim initiation"
        },
        {
            step: 8,
            query: "yes",
            description: "Response to scheduled tele-consultation message (simulating after scheduled messages)"
        },
        {
            step: 9,
            query: "Monday 2:00 PM",
            description: "Consultation preferences"
        }
    ];

    for (const testStep of testSteps) {
        try {
            console.log(`\n📍 STEP ${testStep.step}: ${testStep.description}`);
            console.log(`💬 User: "${testStep.query}"`);
            
            const response = await axios.post(`${BASE_URL}/api/customers/${CUSTOMER_ID}/query`, {
                query: testStep.query,
                intent: "EVENT_DRIVEN_CLAIM_EPISODE"
            });
            
            console.log(`🤖 AI: ${response.data.answer}`);
            
            if (response.data.conversationId) {
                console.log(`🆔 Conversation ID: ${response.data.conversationId}`);
            }
            
            if (response.data.currentStage) {
                console.log(`📍 Current Stage: ${response.data.currentStage}`);
            }
            
            // Add delay between steps
            await new Promise(resolve => setTimeout(resolve, 2000));
            
        } catch (error) {
            console.error(`❌ Error in step ${testStep.step}:`, error.response?.data || error.message);
            break;
        }
    }
    
    console.log('\n✅ Tele-consultation flow test completed!');
}

// Run the test
testTeleconsultationFlow().catch(console.error);
