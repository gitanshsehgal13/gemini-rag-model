/**
 * Test script to verify claim initiation in the orchestrator flow
 * This simulates a complete admission journey and checks if claim API is called
 */

const CustomerService = require('./src/services/customerService');
const path = require('path');
const fs = require('fs');

// Color logging for better visibility
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

function log(color, message) {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testClaimOrchestrator() {
    try {
        log('cyan', '\n' + '='.repeat(80));
        log('bright', '🧪 TESTING CLAIM INITIATION IN ORCHESTRATOR MODE');
        log('cyan', '='.repeat(80) + '\n');

        // Initialize customer service
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || 'AIzaSyDtFEEOyL0IpqZCV_Dl-3f2fCHKiSZTpkk';
        const config = {
            googleAiApiKey: apiKey,  // CustomerService expects 'googleAiApiKey'
            embeddingsModel: 'models/embedding-001'
        };
        
        log('blue', `Using API Key: ${apiKey.substring(0, 20)}...`);

        log('blue', '📦 Initializing CustomerService...');
        const customerService = new CustomerService(config);

        const customerId = '9830323302';
        const intent = 'EVENT_DRIVEN_CLAIM_EPISODE';

        // Simulate a complete admission journey
        const conversations = [
            {
                step: 1,
                query: 'Hospital locator journey viewed',
                expectedStage: 'greeting',
                description: 'Initial greeting'
            },
            {
                step: 2,
                query: 'I need help finding hospitals',
                expectedStage: 'identify_patient',
                description: 'Customer confirms need for help'
            },
            {
                step: 3,
                query: 'It\'s for my wife',
                expectedStage: 'medical_reason',
                description: 'Identifies patient as spouse'
            },
            {
                step: 4,
                query: 'She has a hand fracture in Mumbai',
                expectedStage: 'show_hospitals',
                description: 'Provides medical reason and location'
            },
            {
                step: 5,
                query: 'I want to go with Swastik Hospital',
                expectedStage: 'confirm_admission',
                description: 'Selects hospital'
            },
            {
                step: 6,
                query: 'Yes, we need admission',
                expectedStage: 'collect_admission_details',
                description: 'Confirms admission'
            },
            {
                step: 7,
                query: 'Estimated cost is 20000',
                expectedStage: 'collect_admission_details', // Partial - still need date
                description: 'Provides cost (partial data)'
            },
            {
                step: 8,
                query: '20 October 08:00 AM',
                expectedStage: 'collect_preferences',
                description: 'Provides date (all data collected) - should trigger claim initiation'
            }
        ];

        // Execute conversations
        for (const conversation of conversations) {
            log('yellow', `\n${'─'.repeat(80)}`);
            log('bright', `STEP ${conversation.step}: ${conversation.description}`);
            log('yellow', '─'.repeat(80));
            log('magenta', `Query: "${conversation.query}"`);
            log('magenta', `Expected Stage: ${conversation.expectedStage}\n`);

            const response = await customerService.queryDocuments(
                customerId,
                conversation.query,
                { intent, communicationMode: 'WHATSAPP' }
            );

            // Display response
            log('green', `✅ Response received`);
            log('blue', `Current Stage: ${response.currentStage || 'N/A'}`);
            
            // Check collected data
            if (response.collectedData) {
                log('cyan', '\n📊 Collected Data:');
                Object.keys(response.collectedData).forEach(key => {
                    const value = response.collectedData[key];
                    if (Array.isArray(value)) {
                        log('cyan', `  - ${key}: [${value.length} items]`);
                    } else if (typeof value === 'object' && value !== null) {
                        log('cyan', `  - ${key}: [object]`);
                    } else {
                        log('cyan', `  - ${key}: ${value}`);
                    }
                });
            }

            // Check for claim initiation
            if (response.collectedData?.intimationId) {
                log('green', '\n' + '🎉'.repeat(40));
                log('bright', `🎉 CLAIM INITIATED SUCCESSFULLY!`);
                log('green', `Intimation ID: ${response.collectedData.intimationId}`);
                log('green', '🎉'.repeat(40) + '\n');
            }

            // Check if we have all required data
            const hasAllData = 
                response.collectedData?.selectedHospital &&
                response.collectedData?.admissionDate &&
                response.collectedData?.estimatedCost;
            
            if (hasAllData && !response.collectedData?.intimationId) {
                log('red', '\n⚠️  WARNING: All data collected but NO CLAIM INITIATED!');
                log('red', `   - Selected Hospital: ${response.collectedData.selectedHospital}`);
                log('red', `   - Admission Date: ${response.collectedData.admissionDate}`);
                log('red', `   - Estimated Cost: ${response.collectedData.estimatedCost}`);
                log('red', `   - Intimation ID: ${response.collectedData.intimationId || 'MISSING!'}\n`);
            }

            log('blue', `\n💬 AI Response:\n${response.answer}\n`);

            // Add delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        log('green', '\n' + '='.repeat(80));
        log('bright', '✅ TEST COMPLETED');
        log('green', '='.repeat(80) + '\n');

    } catch (error) {
        log('red', '\n❌ TEST FAILED');
        log('red', `Error: ${error.message}`);
        console.error(error);
    }
}

// Run the test
if (require.main === module) {
    testClaimOrchestrator()
        .then(() => {
            log('green', '\n✅ Test script finished');
            process.exit(0);
        })
        .catch(error => {
            log('red', '\n❌ Test script failed');
            console.error(error);
            process.exit(1);
        });
}

module.exports = { testClaimOrchestrator };

