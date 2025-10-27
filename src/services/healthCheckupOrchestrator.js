const BaseOrchestrator = require('./baseOrchestrator');
const SchedulingAgent = require('./schedulingAgent');
const fs = require('fs-extra');
const path = require('path');

/**
 * Health Checkup Journey Orchestrator
 * Manages the HEALTH_CHECKUP_BOOKING_JOURNEY conversation flow
 */
class HealthCheckupOrchestrator extends BaseOrchestrator {
    constructor(intentData, geminiService, hospitalService, intentJourneyService = null) {
        super(intentData, geminiService, hospitalService);
        this.stages = intentData.conversationFlow.stages;
        this.recommendedActions = intentData.recomendedAction || [];
        this.healthCheckupPlans = this.loadHealthCheckupPlans();
        
        // Reinitialize scheduling agent with the correct intentJourneyService
        if (intentJourneyService) {
            this.schedulingAgent = new SchedulingAgent(geminiService, intentJourneyService);
        }
    }

    /**
     * Load health checkup plans from JSON file
     */
    loadHealthCheckupPlans() {
        try {
            const plansPath = path.join(__dirname, '../../data/healthCheckupPlans.json');
            const plans = JSON.parse(fs.readFileSync(plansPath, 'utf8'));
            console.log(`✅ Loaded ${plans.length} health checkup plan(s)`);
            if (plans.length > 0) {
                console.log(`📋 First plan: ${plans[0].name} (${plans[0].testDetails.length} tests)`);
            }
            return plans;
        } catch (error) {
            console.error('❌ Error loading health checkup plans:', error);
            return [];
        }
    }

    /**
     * Override system prompts for health checkup journey
     */
    getSystemPrompts() {
        return `**Your RULES:**

1. **Role & Tone:** You are a Proactive TATA AIG Health Insurance Health Concierge. Be professional, empathetic, and supportive. Prioritize clarity and conciseness. Acknowledge the user's message before transitioning to the next step. Assume the user may be stressed and avoid overly formal language. Never greet again after the first message in a session.

2. **Natural Variation:** Vary your language and phrasing in each response. Don't use the same words or sentences repeatedly. Be conversational and warm - like talking to a friend.

3. **Formatting:** All responses must be formatted for WhatsApp. Use *bold* for key names or action items. Use line breaks (\\n) to improve readability.

4. **Emoji Usage:** Use 1-2 relevant emojis sparingly when they add warmth or clarity (e.g., 🏥 for hospitals, ✅ for confirmation, 📋 for forms, 💰 for costs 👋 for greetings). Avoid overuse - emojis should enhance, not distract from the message.

5. **Policy Data:** Whenever possible, use the *actual names* of family members (Vineet, Punita, Aradhya, Akshat) instead of generic roles (e.g., use 'Punita' instead of 'your wife').

6. **Process Focus:** Always guide the customer to the immediate next required step in the TATA AIG process. Do not jump ahead or discuss steps not yet relevant.

7. **Conversation History:** If we have recent conversation history, use it to understand context and references (like "this process", "that", "it", etc.).

8. **Avoid Repetition:** DON'T repeat questions already answered above. DON'T greet again (only greet in first message). Use info from history (who, what, where mentioned). Vary your language - be fresh and natural each time.`;
    }

    /**
     * Process the health checkup journey with orchestrator
     */
    async processHealthCheckupJourney(customerId, query, conversationHistory = [], conversationState = null) {
        try {
            console.log(`\n🏥 Processing Health Checkup Journey for customer: ${customerId}`);
            console.log(`Query: "${query}"`);
            console.log("conversationState:",JSON.stringify(conversationState));
            // Initialize conversation state if not provided
            if (!conversationState) {
                // Always start from greeting on first inbound message
                conversationState = {
                    currentStageId: 'greeting',
                    collectedData: {},
                    stageHistory: [],
                    conversationId: this.generateConversationId()
                };
            }

            // Check if this is the first message AND we're still in greeting stage
            const isFirstMessage = conversationHistory.length === 0 && conversationState.currentStageId === 'greeting';

            // Add incoming message to conversation history
            conversationHistory.push({
                communicationMode: "WHATSAPP",
                incommingMessage: query,
                timestamp: new Date().toISOString()
            });

            // Log current state
            this.logConversationState(conversationState.conversationId, conversationState.currentStageId, conversationState.collectedData);

            // Generate AI response using orchestrator
            const aiResponse = await this.generateHealthCheckupResponse(
                conversationState,
                conversationHistory,
                query,
                isFirstMessage
            );

            // Add AI response to conversation history
            conversationHistory.push({
                communicationMode: "WHATSAPP",
                sentMessage: aiResponse,
                timestamp: new Date().toISOString()
            });

            // Update conversation state
            conversationState.stageHistory.push({
                stageId: conversationState.currentStageId,
                timestamp: new Date().toISOString(),
                userMessage: query,
                aiResponse: aiResponse
            });

            console.log(`✅ Health Checkup Journey Response Generated`);
            console.log(`Response: "${aiResponse}"`);

            return {
                answer: aiResponse,
                conversationId: conversationState.conversationId,
                conversationState: conversationState,
                conversationHistory: conversationHistory
            };

        } catch (error) {
            console.error('Error processing health checkup journey:', error);
            throw error;
        }
    }

    /**
     * Generate AI response for health checkup journey
     */
    async generateHealthCheckupResponse(conversationState, conversationHistory, query, isFirstMessage = false) {
        try {
            const currentStage = this.stages.find(stage => stage.id === conversationState.currentStageId);
            if (!currentStage) {
                throw new Error(`Stage not found: ${conversationState.currentStageId}`);
            }

            console.log(`\n🎯 Current Stage: ${currentStage.name} (${currentStage.id})`);

            // Extract data from customer message
            const extractedData = this.extractHealthCheckupData(query, conversationState.collectedData);
            
            // Update collected data
            Object.assign(conversationState.collectedData, extractedData);

            // Check if current stage is complete and should transition
            const shouldTransition = this.shouldTransitionStage(currentStage, conversationState.collectedData, query, isFirstMessage);
            
            let stageForPrompt = currentStage;
            if (shouldTransition) {
                const nextStageId = this.determineNextHealthCheckupStage(currentStage, conversationState.collectedData, query);
                if (nextStageId && nextStageId !== conversationState.currentStageId) {
                    console.log(`🔄 Stage complete, transitioning: ${conversationState.currentStageId} → ${nextStageId}`);
                    conversationState.currentStageId = nextStageId;
                    stageForPrompt = this.stages.find(stage => stage.id === nextStageId);
                }
            }

            // Build stage-specific prompt using getStagePrompt
            // This function now intelligently decides what to ask based on customer response and collected data
            const stagePrompt = this.getStagePrompt(stageForPrompt, conversationState.collectedData, isFirstMessage, query);
            console.log(`\n📋 Stage Prompt Length: ${stagePrompt.length} characters`);
            console.log(`📋 Stage Prompt Preview: ${stagePrompt.substring(0, 200)}...`);
            
            const customerName = this.policyInfo ? this.policyInfo.policyholder.split(' ')[0] : 'Vineet';
            
            // Build full prompt with customer context
            let prompt = `You are a ${this.intentData.brand_voice?.persona || 'Health Concierge'}. Be ${this.intentData.brand_voice?.tone || 'friendly, professional, health-focused'}.\n\n`;
            prompt += `Customer: ${customerName}\n`;
            
            if (this.policyInfo?.insuredMembers) {
                prompt += `Family: `;
                this.policyInfo.insuredMembers.forEach((m, i) => {
                    prompt += `${m.name.split(' ')[0]} (${m.relationship})`;
                    if (i < this.policyInfo.insuredMembers.length - 1) prompt += ', ';
                });
                prompt += `\n`;
            }

            prompt += `\n**Current Task:** ${stageForPrompt.name}\n`;
            prompt += `**Instructions:** ${stagePrompt}\n`;
            
            // Add conversation history (show last 5 messages for better context)
            if (conversationHistory.length > 0) {
                prompt += `\n**Conversation History:**\n`;
                conversationHistory.slice(-5).forEach(msg => {
                    if (msg.incommingMessage) prompt += `Customer: ${msg.incommingMessage}\n`;
                    else if (msg.sentMessage) prompt += `You: ${msg.sentMessage}\n`;
                });
                prompt += `\n**Important:** Use the conversation history to understand context, but vary your language and phrasing. Be natural, conversational and not too casual or too formal - don't copy previous responses word-for-word.`;
            }
            
            // Add collected data context
            if (Object.keys(conversationState.collectedData).length > 0) {
                prompt += `**Collected Data:** ${JSON.stringify(conversationState.collectedData, null, 2)}\n\n`;
            }

            console.log(`\n📝 Prompt sent to Gemini:`);
            console.log(prompt);

            // Generate response from Gemini
            const response = await this.geminiService.generateIntentBasedResponse(prompt);
            
            // If we reached confirm_appointment, schedule follow-ups and transition to schedule_reminders
            if (conversationState.currentStageId === 'confirm_appointment') {
                try {
                    const customerFirstName = this.policyInfo ? this.policyInfo.policyholder.split(' ')[0] : 'Customer';
                    const appointmentDate = conversationState.collectedData?.preferredDate || '';
                    console.log(`📆 Triggering health checkup reminders for ${customerFirstName} on ${appointmentDate}`);
                    await this.scheduleHealthCheckupReminders(
                        appointmentDate, 
                        customerFirstName, 
                        conversationState.conversationId, 
                        '9830323302', 
                        conversationState.collectedData,
                        conversationHistory  // Pass conversation history to add scheduled messages
                    );
                    
                    // Transition to schedule_reminders stage after scheduling messages
                    console.log(`🔄 Transitioning to schedule_reminders stage after scheduling messages`);
                    conversationState.currentStageId = 'schedule_reminders';
                } catch (err) {
                    console.error('Error scheduling health checkup reminders:', err);
                }
            }

            return response;

        } catch (error) {
            console.error('Error generating health checkup response:', error);
            return "I apologize, but I'm having trouble processing your request right now. Please try again or contact our support team.";
        }
    }

    /**
     * Extract data specific to health checkup journey
     */
    extractHealthCheckupData(message, collectedData) {
        const extractedData = {};
        const messageLower = message.toLowerCase();

        // Family member selection
        const memberNames = ['vineet', 'punita', 'aradhya', 'akshat', 'self', 'myself', 'spouse', 'wife', 'daughter', 'son'];
        const foundMembers = [];
        
        memberNames.forEach(name => {
            if (messageLower.includes(name)) {
                if (name === 'vineet' || name === 'self' || name === 'myself') {
                    if (!foundMembers.includes('Vineet')) foundMembers.push('Vineet');
                } else if (name === 'punita' || name === 'spouse' || name === 'wife') {
                    if (!foundMembers.includes('Punita')) foundMembers.push('Punita');
                } else if (name === 'aradhya' || name === 'daughter') {
                    if (!foundMembers.includes('Aradhya')) foundMembers.push('Aradhya');
                } else if (name === 'akshat' || name === 'son') {
                    if (!foundMembers.includes('Akshat')) foundMembers.push('Akshat');
                }
            }
        });
        
        if (foundMembers.length > 0) {
            extractedData.selectedMembers = foundMembers;
        }

        // Check for "all" or "everyone" or "family"
        if (messageLower.includes('all') || messageLower.includes('everyone') || messageLower.includes('entire family') || messageLower.includes('whole family')) {
            extractedData.selectedMembers = ['Vineet', 'Punita', 'Aradhya', 'Akshat'];
        }

        // Package selection MUST NOT be auto-inferred here. Selection happens only in show_package_options on explicit user acceptance.

        // Initial intent confirmation (for greeting stage)
        if (this.isPositiveResponse(message)) {
            extractedData.initialIntent = true;
            extractedData.healthManagerCallInterest = 'yes';
        } else if (this.isNegativeResponse(message)) {
            extractedData.healthManagerCallInterest = 'no';
        }

        // Date and time extraction (enhanced for health checkup)
        const commonData = this.extractDataFromMessage(message, collectedData);
        
        // Enhanced date extraction for health checkup (handles "tomorrow", "next week", etc.)
        
        // Handle relative dates
        if (messageLower.includes('tomorrow')) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            extractedData.preferredDate = tomorrow.toLocaleDateString('en-GB', { 
                day: 'numeric', 
                month: 'short', 
                year: 'numeric' 
            });
        } else if (messageLower.includes('next week')) {
            const nextWeek = new Date();
            nextWeek.setDate(nextWeek.getDate() + 7);
            extractedData.preferredDate = nextWeek.toLocaleDateString('en-GB', { 
                day: 'numeric', 
                month: 'short', 
                year: 'numeric' 
            });
        } else if (commonData.date) {
            extractedData.preferredDate = commonData.date;
        }
        
        // Enhanced time extraction for health checkup
        if (commonData.time) {
            extractedData.preferredTime = commonData.time;
        } else {
            // Handle time patterns like "10 AM", "2 PM", etc.
            const timePattern = /(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)/i;
            const timeMatch = message.match(timePattern);
            if (timeMatch) {
                extractedData.preferredTime = timeMatch[0];
            }
        }
        
        // Include other common data
        Object.assign(extractedData, commonData);

        // Address extraction
        if (messageLower.includes('address') || messageLower.includes('location')) {
            extractedData.address = message;
        }

        console.log(`📊 Extracted Health Checkup Data:`, extractedData);
        return extractedData;
    }

    /**
     * Check if the current stage should transition to the next stage
     * This is called BEFORE generating the response to decide if we should move forward
     */
    shouldTransitionStage(currentStage, collectedData, query, isFirstMessage = false) {
        console.log(`\n🔍 Checking if stage ${currentStage.id} should transition...`);
        
        // Special handling for first message - NEVER transition on first message
        // The first message should always use its own stage template (greeting)
        if (isFirstMessage) {
            console.log(`   ⏸️ First message - staying in current stage to show greeting`);
            return false;
        }
        
        // Special handling for each stage
        switch (currentStage.id) {
            case 'greeting':
                // Transition if customer shows intent (positive response or mentions health checkup)
                if (this.isPositiveResponse(query) || query.toLowerCase().includes('health checkup')) {
                    console.log(`   ✅ Greeting complete - customer showed intent`);
                    return true;
                }
                return false;
                
            case 'identify_member':
                // Transition if members are selected OR customer gives positive response
                if (collectedData.selectedMembers && collectedData.selectedMembers.length > 0) {
                    console.log(`   ✅ Members identified: ${collectedData.selectedMembers.join(', ')}`);
                    return true;
                }
                if (this.isPositiveResponse(query)) {
                    // Default to policyholder
                    collectedData.selectedMembers = ['Vineet'];
                    console.log(`   ✅ Defaulting to policyholder (Vineet)`);
                    return true;
                }
                return false;
                
            case 'show_package_options':
                // Transition if customer accepts or declines the package
                if (this.isPositiveResponse(query)) {
                    // Mark package as selected
                    if (this.healthCheckupPlans && this.healthCheckupPlans.length > 0) {
                        collectedData.selectedPackage = this.healthCheckupPlans[0].name;
                        collectedData.selectedPlanDetails = this.healthCheckupPlans[0];
                    }
                    console.log(`   ✅ Package accepted`);
                    return true;
                }
                if (this.isNegativeResponse(query)) {
                    console.log(`   ❌ Package declined`);
                    return true;
                }
                return false;
                
            case 'collect_scheduling_details':
                // Transition if we have both date and time
                const hasDate = !!collectedData.preferredDate;
                const hasTime = !!collectedData.preferredTime;
                
                if (hasDate && hasTime) {
                    // Auto-set collection method
                    if (!collectedData.collectionMethod) {
                        collectedData.collectionMethod = 'home sample collection';
                    }
                    console.log(`   ✅ Scheduling details collected (date: ${collectedData.preferredDate}, time: ${collectedData.preferredTime})`);
                    return true;
                }
                console.log(`   ⏸️ Still collecting scheduling details (hasDate: ${hasDate}, hasTime: ${hasTime})`);
                return false;
                
            case 'confirm_appointment':
                // Auto-transition after confirmation
                console.log(`   ✅ Appointment confirmed`);
                return true;
            case 'schedule_reminders':
                // Transition based on customer's response to teleconsultation offer
                if (this.isPositiveResponse(query)) {
                    collectedData.teleconsultationInterest = 'yes';
                    console.log(`   ✅ Teleconsultation accepted - transitioning to teleconsultation_call`);
                    return true;
                }
                else if (this.isNegativeResponse(query)) {
                    collectedData.teleconsultationInterest = 'no';
                    console.log(`   ❌ Teleconsultation declined - transitioning to close_politely`);
                    return true;
                }
                console.log(`   ⏸️ Waiting for customer response to teleconsultation offer`);
                return false;
                
            case 'teleconsultation_call':
                // Auto-transition to end after confirming teleconsultation
                console.log(`   ✅ Teleconsultation confirmed - journey complete`);
                return true;
                
            case 'close_politely':
                // Auto-transition to end after closing politely
                console.log(`   ✅ Closed politely - journey complete`);
                return true;
                
            case 'end':
                // Journey is complete, no more transitions
                console.log(`   ✅ Journey complete - no further transitions`);
                return false;
                
            default:
                // For other stages, don't auto-transition
                return false;
        }
    }

    /**
     * Determine next stage for health checkup journey
     */
    determineNextHealthCheckupStage(currentStage, collectedData, query) {
        const transitions = currentStage.transitions;
        
        console.log(`\n🔄 Determining next stage from: ${currentStage.id}`);
        console.log(`   Query: "${query}"`);
        console.log(`   Collected Data:`, JSON.stringify(collectedData, null, 2));
        console.log(`   Available Transitions:`, JSON.stringify(transitions, null, 2));
        
        // Universal check for negative responses across all stages
        if (this.isNegativeResponse(query)) {
            console.log(`❌ Customer declined at ${currentStage.id} stage, transitioning to offer_health_manager_call`);
            return transitions.declined || 'offer_health_manager_call';
        }
        
        // Special handling for greeting stage
        if (currentStage.id === 'greeting') {
            if (this.isPositiveResponse(query)) {
                collectedData.initialIntent = true; // Ensure it's set
                return transitions.yes || 'identify_member';
            } else if (this.isNegativeResponse(query)) {
                return transitions.no || 'offer_health_manager_call';
            }
            // Default to identify_member if response is unclear
            collectedData.initialIntent = true;
            return transitions.default || 'identify_member';
        }
        
        // Check for specific transitions based on collected data
        if (transitions.yes && this.isPositiveResponse(query)) {
            return transitions.yes;
        }
        
        if (transitions.no && this.isNegativeResponse(query)) {
            return transitions.no;
        }

        // Special handling for identify_member stage
        if (currentStage.id === 'identify_member') {
            if (collectedData.selectedMembers && collectedData.selectedMembers.length > 0) {
                console.log(`✅ Members identified: ${collectedData.selectedMembers.join(', ')}`);
                return transitions.collected || 'show_package_options';
            }
            
            // If user gives a positive response but no specific members mentioned, default to policyholder
            if (this.isPositiveResponse(query)) {
                collectedData.selectedMembers = ['Vineet']; // Default to policyholder
                console.log(`✅ Defaulting to policyholder (Vineet) for health checkup`);
                return transitions.collected || 'show_package_options';
            }
            
            // If no members extracted yet, stay in this stage
            return currentStage.id;
        }
     
        // Special handling for show_package_options stage
        if (currentStage.id === 'show_package_options') {

            if (this.isPositiveResponse(query)) {
                // Mark package as selected
                if (this.healthCheckupPlans && this.healthCheckupPlans.length > 0) {
                    collectedData.selectedPackage = this.healthCheckupPlans[0].name;
                    collectedData.selectedPlanDetails = this.healthCheckupPlans[0];
                }
                console.log(`✅ Package accepted, transitioning to collect_scheduling_details`);
                return transitions.accepted || 'collect_scheduling_details';
            } else if (this.isNegativeResponse(query)) {
                console.log(`❌ Package declined, offering health manager call`);
                return transitions.declined || 'offer_health_manager_call';
            }
            // Stay in this stage if response is unclear
            return currentStage.id;
        }

        // Special handling for confirm_appointment stage - auto-transition to schedule_reminders
        if (currentStage.id === 'confirm_appointment') {
            // Check if we have all required data (date and time)
            const hasDate = !!collectedData.preferredDate;
            const hasTime = !!collectedData.preferredTime;
            
            if (hasDate && hasTime) {
                console.log(`✅ Appointment confirmed with date and time, auto-transitioning to schedule_reminders`);
                return transitions.complete || 'schedule_reminders';
            }
            // Stay in this stage if data is missing
            return currentStage.id;
        }

        // Check for data-based transitions
        if (transitions.collected) {
            // Special handling for collect_scheduling_details stage
            if (currentStage.id === 'collect_scheduling_details') {
                // Only check for date and time, collection method is auto-set
                const hasDate = !!collectedData.preferredDate;
                const hasTime = !!collectedData.preferredTime;
                
                if (hasDate && hasTime) {
                    // Auto-set collection method if not already set
                    if (!collectedData.collectionMethod) {
                        collectedData.collectionMethod = 'home sample collection';
                    }
                    return transitions.collected;
                }
            } else {
                // For other stages, check required data normally
                const requiredData = currentStage.requiredData || [];
                const hasRequiredData = requiredData.every(field => collectedData[field]);
                
                if (hasRequiredData) {
                    return transitions.collected;
                }
            }
        }

        if (transitions.complete) {
            const requiredData = currentStage.requiredData || [];
            const hasRequiredData = requiredData.every(field => collectedData[field]);
            
            if (hasRequiredData) {
                return transitions.complete;
            }
        }

        if (transitions.default) {
            console.log(`   ➡️ Using default transition: ${transitions.default}`);
            return transitions.default;
        }

        // Special handling for tele-consultation response after scheduled messages
        // This handles customer responses to the final scheduled message about tele-consultation
        if (collectedData.scheduledMessagesSent && 
            collectedData.lastScheduledMessage === 'teleconsultation' &&
            (this.isPositiveResponse(query) || this.isNegativeResponse(query))) {
            
            console.log(`📞 Customer responded to tele-consultation offer: ${this.isPositiveResponse(query) ? 'POSITIVE' : 'NEGATIVE'}`);
            return 'teleconsultation_response';
        }

        console.log(`   ⏸️ Staying in current stage: ${currentStage.id}`);
        return currentStage.id; // Stay in current stage
    }

    /**
     * Get stage-specific prompt with conditional logic
     * Similar to claim event orchestrator's getStagePrompt()
     */
    getStagePrompt(stage, collectedData, isFirstMessage = false, query = '') {
        const systemPrompts = this.getSystemPrompts();
        
        // Start with system prompts
        let prompt = `${systemPrompts}\n\n`;
        
        // Add first message greeting if needed
        if (isFirstMessage) {
            const customerName = this.policyInfo ? this.policyInfo.policyholder.split(' ')[0] : 'there';
            prompt += `**FIRST MESSAGE - CRITICAL:** This is the first message in this conversation. 
            
GREET like this example:
"Hi ${customerName}! 👋

I hope you're having a good day.

I wanted to remind you about a valuable benefit you and your family are entitled to: a *free annual health check-up*! This is a great way to stay on top of your well-being and catch any potential issues early.

Would you like me to help you get started with scheduling your health check-up? ✅"

DO NOT introduce yourself as "Proactive TATA AIG Health Insurance Health Concierge" or any formal title. Just greet naturally and get to the point about the health check-up benefit.\n\n`;
        }
        
        // Add stage-specific prompt with conditional logic
        const stagePrompt = stage.promptTemplate || '';
        
        // Universal check for negative responses across all stages
        // Use isNegativeResponse function to detect various forms of "no"
        // if (this.isNegativeResponse(query)) {
        //     prompt += `**Customer declined health checkup.** Offer alternative assistance like health manager call or other insurance services. Be helpful and understanding.`;
        //     return prompt;
        // }
        
        // Stage-specific conditional prompts based on collected data
        if (stage.id === 'identify_member') {
            
            const hasMembers = !!collectedData.selectedMembers;
            
            if (!hasMembers) {
                prompt += `${stagePrompt}\n\n**Be natural and conversational.** Ask which family member(s) need the health checkup. Available: Vineet (self), Punita (spouse), Aradhya (daughter), Akshat (son). Use different phrasing each time - be warm and personal.`;
            } else {
                // Member has been selected; acknowledge only. Package presentation happens in show_package_options
                const memberNames = collectedData.selectedMembers.join(' and ');
                prompt += `${stagePrompt}\n\n**Acknowledge naturally:** ${memberNames} selected. Ask if they want me to recommend health checkup plan? Be conversational and guide to next step without being repetitive.`;
            }
        } else if (stage.id === 'collect_scheduling_details') {
            const hasDate = !!collectedData.preferredDate;
            const hasTime = !!collectedData.preferredTime;
            
            // Default collection method to home sample collection (don't ask)
            if (!collectedData.collectionMethod) {
                collectedData.collectionMethod = 'home sample collection';
            }
            
            if (!hasDate && !hasTime) {
                prompt += `${stagePrompt}\n\n**Ask naturally for scheduling:** We do home sample collection. Ask for their preferred date and time in a conversational way. Vary your phrasing - be warm and helpful.`;
            } else if (hasDate && !hasTime) {
                prompt += `${stagePrompt}\n\n**Follow up naturally:** They mentioned ${collectedData.preferredDate}. Now ask for their preferred time in a conversational way.`;
            } else if (!hasDate && hasTime) {
                prompt += `${stagePrompt}\n\n**Follow up naturally:** They mentioned ${collectedData.preferredTime}. Now ask for their preferred date in a conversational way.`;
            } else {
                prompt += stagePrompt;
            }
        } else if (stage.id === 'show_package_options') {
            // Always include the stage prompt template first
            prompt += `${stagePrompt}\n\n`;
            
            const selectedMembers = collectedData.selectedMembers || [];
            const memberContext = selectedMembers.length > 0 
                ? `for ${selectedMembers.join(' and ')}` 
                : '';
            
            // Get available health checkup plan
            let planDetails = '';
            if (this.healthCheckupPlans && this.healthCheckupPlans.length > 0) {
                const plan = this.healthCheckupPlans[0]; // Use the first available plan
                console.log(`📦 Adding health checkup plan to prompt: ${plan.name}`);
                planDetails = `\n\n**Available Health Check-up Package ${memberContext}:**
*${plan.name}*

*All Tests Included:*
${plan.testDetails.map((test, i) => `${i + 1}. ${test}`).join('\n')}`;
            } else {
                console.log(`⚠️ No health checkup plans available to add to prompt`);
            }
            
            prompt += `**Present the health checkup package naturally.** 

**Your task:** Acknowledge ${selectedMembers.join(' and ')} and present the recommended package below. Be conversational and warm - vary your language each time.

**Package to present:**${planDetails}

**Be natural:** Ask if they'd like to proceed with this package, but use different phrasing each time. Be helpful and encouraging.`;
        } else if (stage.id === 'teleconsultation_response') {
            // Handle customer response to tele-consultation offer
            if (this.isPositiveResponse(query)) {
                prompt += `**POSITIVE RESPONSE TO TELE-CONSULTATION:** Customer wants tele-consultation. Respond with: "We have aligned a tele-consultation with our doctor. He will be calling you in few mins. Be ready with your report."`;
            } else if (this.isNegativeResponse(query)) {
                prompt += `**NEGATIVE RESPONSE TO TELE-CONSULTATION:** Customer declined tele-consultation. Respond with: "Thank you. I am here if you need any assistance."`;
            } else {
                prompt += `**UNCLEAR RESPONSE TO TELE-CONSULTATION:** Ask for clarification about their tele-consultation preference.`;
            }
        } else if (stage.id === 'offer_health_manager_call') {
            prompt += `${stagePrompt}\n\n**CRITICAL:** Offer a health manager call to explain benefits. Be empathetic and understanding.`;
        } else if (stage.id === 'teleconsultation_call') {
            prompt += `${stagePrompt}\n\n**TELECONSULTATION CONFIRMATION:** Customer accepted teleconsultation. Respond with: "We have aligned a tele-consultation with our doctor. He will be calling you in few mins. Be ready with your report."`;
        } else if (stage.id === 'schedule_reminders') {
            // Customer is in the waiting stage after scheduled messages
            prompt += `${stagePrompt}\n\n**WAITING FOR RESPONSE:** Customer has received scheduled messages about their health checkup reports. Wait for their response to the teleconsultation offer.`;
        } else if (stage.id === 'end') {
            // Journey complete
            prompt += `${stagePrompt}\n\n**JOURNEY COMPLETE:** The health checkup journey is complete. Thank the customer warmly and let them know you're available for any future assistance.`;
        } else {
            prompt += stagePrompt;
        }
        
        return prompt;
    }

    /**
     * Build prompt specific to health checkup journey
     * @deprecated - Use getStagePrompt() instead for better stage-specific control
     */
    buildHealthCheckupPrompt(contextPayload) {
        const {
            customerName,
            policyInfo,
            brandVoice,
            businessGoals,
            recommendedActions,
            currentStage,
            collectedData,
            conversationHistory,
            isFirstMessage
        } = contextPayload;

        let prompt = this.getSystemPrompts();

        if (isFirstMessage) {
            prompt += `\n\n**FIRST MESSAGE - CRITICAL:** This is the first message in this conversation. You MUST greet the customer warmly using their first name "${customerName}" and introduce the health check-up benefit.`;
        }

        prompt += `\n\n**Current Stage:** ${currentStage.name}
**Stage Instructions:** ${currentStage.promptTemplate}

**Customer Information:**
- Name: ${customerName}
- Policy: ${policyInfo?.plan || 'TATA AIG MediCare Premier'}
- Free annual health check-up benefit available

**Collected Data So Far:** ${JSON.stringify(collectedData)}

**Recent Conversation:**
${conversationHistory.slice(-3).map(msg => {
    if (msg.incommingMessage) return `Customer: ${msg.incommingMessage}`;
    if (msg.sentMessage) return `You: ${msg.sentMessage}`;
    return '';
}).filter(m => m).join('\n')}

**Instructions:**
1. Follow the stage instructions exactly
2. Use the customer's first name "${customerName}" naturally
3. Be friendly, professional, and health-focused
4. Guide them to the immediate next step in the health check-up process
5. **CRITICAL:** This is a HEALTH CHECKUP journey about preventive care, NOT hospital admission
6. Keep responses concise and conversational

Generate a helpful response for the health check-up journey:`;

        return prompt;
    }

    /**
     * Schedule health checkup reminders
     */
    async scheduleHealthCheckupReminders(appointmentDate, customerName, conversationId = null, customerId = null, collectedData = null, conversationHistory = null) {
        try {
            const reminders = [
                {
                    text: `Kindly remember: Fast for 12 hours (only water allowed). Drink only plain water during the fasting period — avoid tea, coffee, or juice. Do not consume alcohol or smoke for at least 24 hours before sample collection.`,
                    delayInSeconds: 10, // 10 seconds for testing
                    order: 1,
                    type: 'fasting_reminder'
                },
                {
                    text: `Hello ${customerName}, hope your health check-up went smoothly. You'll receive your reports within the next 12 hours. You can track the status of the sample collection on the app as well.`,
                    delayInSeconds: 20, // 20 seconds for testing
                    order: 2,
                    type: 'post_checkup_update'
                },
                {
                    text: `Hello ${customerName}, your health check-up reports are now ready! You can view and download them anytime from the "My Bookings" section in your app. Do you'd like the in-house doctor to review your reports and discuss the results?`,
                    delayInSeconds: 30, // 30 seconds for testing
                    order: 3,
                    type: 'teleconsultation_offer'
                }
            ];

            // Convert reminders to the format expected by scheduleMessages
            const messages = reminders.map(reminder => ({
                text: reminder.text,
                delayInSeconds: reminder.delayInSeconds
            }));
            
            // Use provided IDs or generate defaults
            const finalConversationId = conversationId || this.generateConversationId();
            const finalCustomerId = customerId || '9830323302'; // Default customer ID for health checkup
            
            await this.schedulingAgent.scheduleMessages(finalConversationId, finalCustomerId, messages);

            // Add scheduled messages to conversation history
            if (conversationHistory) {
                reminders.forEach((reminder, index) => {
                    conversationHistory.push({
                        communicationMode: "WHATSAPP",
                        sentMessage: reminder.text,
                        timestamp: new Date(Date.now() + reminder.delayInSeconds * 1000).toISOString(),
                        messageType: 'scheduled',
                        scheduledMessageType: reminder.type,
                        scheduledOrder: reminder.order
                    });
                });
                console.log(`✅ Added ${reminders.length} scheduled messages to conversation history`);
            }

            // Mark that scheduled messages have been sent and track the last message
            if (collectedData) {
                collectedData.scheduledMessagesSent = true;
                collectedData.lastScheduledMessage = 'teleconsultation'; // The last message asks about tele-consultation
            }

            console.log(`✅ Scheduled ${reminders.length} health checkup reminders`);
        } catch (error) {
            console.error('Error scheduling health checkup reminders:', error);
        }
    }
}

module.exports = HealthCheckupOrchestrator;
