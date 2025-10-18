const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const CommunicationService = require('./communicationService');
const SchedulingAgent = require('./schedulingAgent');
const ClaimInitiationService = require('./claimInitiationService');

/**
 * Intent Journey Service
 * Manages intent-based conversation journeys with customers
 */
class IntentJourneyService {
    constructor(geminiService, hospitalService) {
        this.geminiService = geminiService;
        this.hospitalService = hospitalService;
        this.communicationService = new CommunicationService();
        this.claimInitiationService = new ClaimInitiationService(); // Auth token now in the service itself
        this.intentsData = [];
        this.policyInfo = null;
        this.conversationHistories = new Map(); // Store conversation histories by conversationId
        this.customerJourneys = new Map(); // Store active journeys by customerId
        this.loadIntentsData();
        this.loadPolicyInfo();
        // Initialize scheduling agent after other properties are set (needs access to geminiService and this)
        this.schedulingAgent = new SchedulingAgent(this.geminiService, this);
    }

    /**
     * Load intents data from JSON file
     */
    loadIntentsData() {
        try {
            const intentsPath = path.join(__dirname, '../../data/intentBasedJouneys.json');
            this.intentsData = JSON.parse(fs.readFileSync(intentsPath, 'utf8'));
            console.log(`Loaded ${this.intentsData.length} intent definitions`);
        } catch (error) {
            console.error('Error loading intents data:', error);
            this.intentsData = [];
        }
    }

    /**
     * Load policy information from JSON file
     */
    loadPolicyInfo() {
        try {
            const policyInfoPath = path.join(__dirname, '../../data/policyInfo.json');
            this.policyInfo = JSON.parse(fs.readFileSync(policyInfoPath, 'utf8'));
            console.log(`Loaded policy information for ${this.policyInfo.policyholder}`);
        } catch (error) {
            console.error('Error loading policy info:', error);
            this.policyInfo = null;
        }
    }

    /**
     * Get intent configuration by intent name
     * @param {string} intentName - Intent name
     * @returns {Object|null} - Intent configuration
     */
    getIntentConfig(intentName) {
        return this.intentsData.find(intent => intent.intent === intentName) || null;
    }

    /**
     * Start or continue an intent-based journey
     * @param {string} customerId - Customer ID
     * @param {string} intentName - Intent name
     * @param {string} query - Customer query/message
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} - Journey response
     */
    async processIntentJourney(customerId, intentName, query, options = {}) {
        try {
            console.log(`Processing intent journey for customer ${customerId}, intent: ${intentName}`);

            // Get intent configuration
            const intentConfig = this.getIntentConfig(intentName);
            if (!intentConfig) {
                throw new Error(`Intent configuration not found for: ${intentName}`);
            }

            // Get or create conversation ID for this journey
            let journeyData = this.customerJourneys.get(customerId);

            if (!journeyData || journeyData.intent !== intentName) {
                // Start new journey
                const conversationId = uuidv4();
                journeyData = {
                    conversationId,
                    intent: intentName,
                    customerId,
                    status: 'active',
                    startedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                this.customerJourneys.set(customerId, journeyData);
                this.conversationHistories.set(conversationId, []);
                console.log(`Started new journey with conversation ID: ${conversationId}`);
            }

            // Get conversation history
            const conversationHistory = this.conversationHistories.get(journeyData.conversationId) || [];

            // Check if we need to provide hospital recommendations
            const hospitalData = await this.checkAndFetchHospitalData(query, conversationHistory);

            // Save incoming message to history FIRST (before generating response)
            conversationHistory.push({
                communicationMode: options.communicationMode || "WHATSAPP",
                incommingMessage: query,
                timestamp: new Date().toISOString()
            });

            // Update conversation history immediately
            this.conversationHistories.set(journeyData.conversationId, conversationHistory);

            // Build the context for Gemini AFTER updating history
            const contextPayload = {
                intent: intentName,
                customerId: customerId,
                status: journeyData.status,
                customerContextHistory: conversationHistory,
                newIncommingMessage: {
                    communicationMode: options.communicationMode || "WHATSAPP",
                    incommingMessage: query
                },
                brand_voice: intentConfig.brand_voice,
                business_goals: intentConfig.business_goals,
                recomendedAction: intentConfig.recomendedAction,
                hospitalData: hospitalData, // Include hospital data if available
                policyInfo: this.policyInfo // Include policy information for personalization
            };

            console.log('Sending context to Gemini:', JSON.stringify(contextPayload, null, 2));

            // Generate response from Gemini
            const geminiResponse = await this.generateIntentResponse(contextPayload, customerId);
            
            // Check if this is a duplicate of the last sent message
            const lastSentMessage = conversationHistory
                .filter(msg => msg.sentMessage)
                .pop()?.sentMessage;
            
            if (lastSentMessage && lastSentMessage.trim() === geminiResponse.trim()) {
                console.log('🚫 Duplicate message detected - skipping WhatsApp send');
                return {
                    answer: geminiResponse,
                    conversationId: journeyData.conversationId,
                    intent: intentName,
                    conversationHistory: conversationHistory,
                    confidence: 1.0,
                    queryType: 'intent_journey',
                    scheduledFollowUps: false,
                    duplicateSkipped: true
                };
            }

            // Save sent message to history
            conversationHistory.push({
                communicationMode: options.communicationMode || "WHATSAPP",
                sentMessage: geminiResponse,
                timestamp: new Date().toISOString()
            });

            // Update conversation history with sent message
            this.conversationHistories.set(journeyData.conversationId, conversationHistory);

            // Update journey timestamp
            journeyData.updatedAt = new Date().toISOString();
            this.customerJourneys.set(customerId, journeyData);

            // Send message via WhatsApp asynchronously (fire and forget)
            console.log('Sending message via WhatsApp communication service (non-blocking)...');
            
            // Convert escaped newlines to actual newlines for WhatsApp
            const whatsappMessage = geminiResponse.replace(/\\n/g, '\n');
            
            console.log('TEXT TO SEND VIA WHATSAPP:', whatsappMessage);
            if (query == 'Hospital locator journey viewed') {
                this.communicationService.sendMessage(whatsappMessage)
                    .then(sendResult => {
                        console.log('WhatsApp message send result:', sendResult.success ? 'Success' : 'Failed');
                    })
                    .catch(error => {
                        console.error('Error sending WhatsApp message:', error);
                    });
            }
            // Check if we need to schedule follow-up messages
            const schedulingResult = await this.detectAndScheduleFollowUps(
                geminiResponse,
                journeyData.conversationId,
                customerId,
                intentName,
                query
            );

            // Return immediately without waiting for WhatsApp response
            return {
                answer: geminiResponse,
                conversationId: journeyData.conversationId,
                intent: intentName,
                conversationHistory: conversationHistory,
                confidence: 1.0,
                queryType: 'intent_journey',
                scheduledFollowUps: schedulingResult.scheduled || false
            };

        } catch (error) {
            console.error('Error processing intent journey:', error);
            throw error;
        }
    }

    /**
     * Generate response from Gemini for intent journey
     * @param {Object} contextPayload - Context payload with conversation history and intent details
     * @param {string} customerId - Customer ID
     * @returns {Promise<string>} - Generated response
     */
    async generateIntentResponse(contextPayload, customerId) {
        try {
            // Build prompt for Gemini
            const systemPrompt = this.buildSystemPrompt(contextPayload);
            const userMessage = contextPayload.newIncommingMessage.incommingMessage;

            // Use Gemini service to generate response
            const response = await this.geminiService.generateIntentBasedResponse(
                systemPrompt,
                userMessage,
                customerId
            );

            return response;

        } catch (error) {
            console.error('Error generating intent response:', error);
            throw error;
        }
    }

    /**
     * Build system prompt for Gemini based on intent context
     * @param {Object} contextPayload - Context payload
     * @returns {string} - System prompt
     */
    buildSystemPrompt(contextPayload) {
        const { brand_voice, business_goals, recomendedAction, customerContextHistory, policyInfo, hospitalData } = contextPayload;

        let prompt = `You are a ${brand_voice.persona} for an insurance company. Your communication should be ${brand_voice.tone} with a ${brand_voice.style} approach.\n\n`;

        prompt += `**Your Role & Style:**\n`;
        prompt += `- You are a PROACTIVE CONCIERGE who TAKES ACTION on behalf of the customer\n`;
        prompt += `- Write in a NATURAL, HUMANIZED way - like a caring professional having a conversation\n`;
        prompt += `- Be WARM, EMPATHETIC, and genuinely HELPFUL\n`;
        prompt += `- Use emojis SPARINGLY - only 1-2 emojis per message, and only where truly meaningful (e.g., 👋 for greeting, ✅ for confirmation)\n`;
        prompt += `- Keep messages conversational but professional\n`;
        prompt += `- Show real empathy for health concerns\n`;
        prompt += `- Make customers feel valued and supported\n`;
        prompt += `- DO THINGS FOR THEM - don't ask them to check or do things themselves\n\n`;

         prompt += `**WhatsApp Formatting (CRITICAL - ALL MESSAGES MUST FOLLOW THIS):**\n`;
         prompt += `- Use *bold text* for important information (hospital names, dates, key points, names)\n`;
         prompt += `- Use \\n\\n for paragraph breaks (double line breaks)\n`;
         prompt += `- Use \\n for single line breaks within paragraphs\n`;
         prompt += `- NEVER write long paragraphs - break into short, readable sentences\n`;
         prompt += `- Each sentence should be on its own line or with \\n breaks\n`;
         prompt += `- Use numbered lists with \\n breaks between each item\n`;
         prompt += `- Keep messages conversational and easy to read on mobile\n`;
         prompt += `- Maximum 3-4 lines per "paragraph" section\n\n`;

        prompt += `**WhatsApp Message Structure Example:**\n`;
        prompt += `"Hi [Name],\\n\\nI've found excellent hospitals for you!\\n\\n*1. Apollo Hospital*\\n📍 Andheri West\\n🏥 Urology Department\\n\\n*2. Seven Star Hospital*\\n📍 Sector 8\\n🏥 Specialized Care\\n\\nAll hospitals are covered under your *Tata AIG insurance*.\\n\\nShall I schedule your appointment?"\n\n`;

        // Include policy information for personalization
        if (policyInfo) {
            prompt += `**👤 CUSTOMER POLICY INFORMATION (Use this to personalize your responses):**\n\n`;
            prompt += `Policyholder: ${policyInfo.policyholder}\n`;
            prompt += `Policy Number: ${policyInfo.policyNumber}\n`;
            prompt += `Plan: ${policyInfo.plan}\n`;
            prompt += `Sum Insured: ${policyInfo.sumInsured}\n`;
            prompt += `Cumulative Bonus: ${policyInfo.cumulativeBonus}\n`;
            prompt += `Policy Period: ${policyInfo.policyPeriod.from} to ${policyInfo.policyPeriod.to}\n\n`;

            if (policyInfo.insuredMembers && policyInfo.insuredMembers.length > 0) {
                prompt += `**Family Members Covered:**\n`;
                policyInfo.insuredMembers.forEach((member, index) => {
                    prompt += `${index + 1}. ${member.name} (${member.relationship}, Age: ${member.age})\n`;
                });
                prompt += `\n`;
            }

            const firstName = policyInfo.policyholder.split(' ')[0]; // Extract first name only
            prompt += `**PERSONALIZATION TIPS:**\n`;
            prompt += `- Address the customer by their FIRST NAME ONLY: "${firstName}" (not full name)\n`;
            prompt += `- When customer mentions a family member (wife, husband, son, daughter), USE THEIR ACTUAL NAME from the covered family members list above\n`;
            prompt += `- Example: If customer says "my wife", use "${policyInfo.insuredMembers?.find(m => m.relationship === 'Spouse')?.name.split(' ')[0] || 'your wife'}"\n`;
            prompt += `- Example: If customer says "my son", use "${policyInfo.insuredMembers?.find(m => m.relationship === 'Son')?.name.split(' ')[0] || 'your son'}"\n`;
            prompt += `- Example: If customer says "my daughter", use "${policyInfo.insuredMembers?.find(m => m.relationship === 'Daughter')?.name.split(' ')[0] || 'your daughter'}"\n`;
            prompt += `- Use policy details naturally in conversation when relevant\n`;
            prompt += `- Make them feel valued as a ${policyInfo.plan} member\n\n`;
        }

        prompt += `**Business Goals You're Supporting:**\n`;
        business_goals.forEach((goal, index) => {
            prompt += `${index + 1}. ${goal}\n`;
        });
        prompt += `\n`;

        // Debug: Log conversation history
        console.log('🔍 CONVERSATION HISTORY DEBUG:');
        console.log('- History length:', customerContextHistory?.length || 0);
        console.log('- History content:', JSON.stringify(customerContextHistory, null, 2));
        
        // Analyze conversation flow stage
        const hasAskedWhoNeedsCare = customerContextHistory?.some(msg => 
            msg.sentMessage && (
                msg.sentMessage.toLowerCase().includes('family member') ||
                msg.sentMessage.toLowerCase().includes('who') ||
                msg.sentMessage.toLowerCase().includes('yourself')
            )
        );
        
        const hasAskedMedicalReason = customerContextHistory?.some(msg => 
            msg.sentMessage && (
                msg.sentMessage.toLowerCase().includes('medical reason') ||
                msg.sentMessage.toLowerCase().includes('what') && msg.sentMessage.toLowerCase().includes('issue')
            )
        );
        
        const hasShownHospitals = customerContextHistory?.some(msg => 
            msg.sentMessage && (
                msg.sentMessage.includes('Hospital') && 
                (msg.sentMessage.includes('1.') || msg.sentMessage.includes('2.'))
            )
        );
        
        const hasAskedAboutAdmission = customerContextHistory?.some(msg => 
            msg.sentMessage && (
                msg.sentMessage.toLowerCase().includes('admission') ||
                msg.sentMessage.toLowerCase().includes('hospitalization')
            )
        );
        
        console.log('🔍 CONVERSATION FLOW STAGE:');
        console.log('- Has asked who needs care:', hasAskedWhoNeedsCare);
        console.log('- Has asked medical reason:', hasAskedMedicalReason);
        console.log('- Has shown hospitals:', hasShownHospitals);
        console.log('- Has asked about admission:', hasAskedAboutAdmission);
        
        // Add specific instructions based on conversation flow stage
        if (hasAskedMedicalReason && !hasShownHospitals && hospitalData && hospitalData.hospitals && hospitalData.hospitals.length > 0) {
            prompt += `**🚨 CRITICAL NEXT STEP: You have hospital data available. You MUST show the hospitals to the customer now!**\n`;
            prompt += `Show all ${hospitalData.hospitals.length} hospitals with their details (name, address, location).\n\n`;
        } else if (hasShownHospitals && !hasAskedAboutAdmission) {
            prompt += `**🚨 CRITICAL NEXT STEP: You have shown hospitals. Now ask if they need more info on any specific hospital.**\n\n`;
        }
        
        // Check if we've already asked for cost and date/time
        const hasAskedForCostAndDate = customerContextHistory?.some(msg => 
            msg.sentMessage && (
                msg.sentMessage.toLowerCase().includes('estimated cost') ||
                msg.sentMessage.toLowerCase().includes('date and time') ||
                msg.sentMessage.toLowerCase().includes('date/time')
            )
        );
        
        // Check if customer has already provided cost and date/time
        const hasProvidedCostAndDate = customerContextHistory?.some(msg => 
            msg.incommingMessage && (
                msg.incommingMessage.toLowerCase().includes('cost') ||
                msg.incommingMessage.toLowerCase().includes('monday') ||
                msg.incommingMessage.toLowerCase().includes('tuesday') ||
                msg.incommingMessage.toLowerCase().includes('wednesday') ||
                msg.incommingMessage.toLowerCase().includes('thursday') ||
                msg.incommingMessage.toLowerCase().includes('friday') ||
                msg.incommingMessage.toLowerCase().includes('saturday') ||
                msg.incommingMessage.toLowerCase().includes('sunday') ||
                msg.incommingMessage.match(/\d+/)
            )
        );
        
        console.log('🔍 QUESTION STATUS:');
        console.log('- Has asked for cost/date:', hasAskedForCostAndDate);
        console.log('- Has provided cost/date:', hasProvidedCostAndDate);

        if (customerContextHistory && customerContextHistory.length > 0) {
            prompt += `**🔴 CRITICAL - PREVIOUS CONVERSATION HISTORY (READ CAREFULLY):**\n\n`;
            prompt += `⚠️ You MUST review this conversation history and remember what has already been discussed.\n`;
            prompt += `⚠️ DO NOT ask questions that have already been answered!\n`;
            prompt += `⚠️ If customer mentioned a family member (wife/son/daughter), use their ACTUAL NAME from the Family Members list above.\n`;
            prompt += `⚠️ DO NOT greet again with "Hi [Name]" - you already greeted in the first message!\n`;
            prompt += `⚠️ Continue from where the conversation left off.\n\n`;
            
            // Add specific instructions based on conversation state
            if (hasAskedForCostAndDate && !hasProvidedCostAndDate) {
                prompt += `**🚨 IMPORTANT: You have already asked for estimated cost and date/time. DO NOT ask again! Wait for customer's response.**\n\n`;
            } else if (hasProvidedCostAndDate) {
                prompt += `**🚨 IMPORTANT: Customer has already provided cost and date/time information. Move to the next step in the conversation.**\n\n`;
            }

            customerContextHistory.forEach((message, index) => {
                if (message.incommingMessage) {
                    prompt += `Customer: ${message.incommingMessage}\n`;
                } else if (message.sentMessage) {
                    prompt += `You: ${message.sentMessage}\n`;
                }
            });
            prompt += `\n`;
            prompt += `**What You Already Know From Above:**\n`;
            prompt += `- Review the conversation carefully\n`;
            prompt += `- If customer mentioned who needs care, you KNOW who it is - don't ask again\n`;
            prompt += `- If customer mentioned location, you KNOW the location - don't ask again\n`;
            prompt += `- If customer mentioned medical issue, you KNOW the issue - don't ask again\n`;
            prompt += `- If customer selected a hospital, you KNOW which one - don't ask again\n`;
            prompt += `- You already greeted them - DON'T say "Hi [Name]" again\n`;
            prompt += `- Move to the NEXT step in the conversation flow\n\n`;
        } else {
            prompt += `**🟢 NEW CONVERSATION - FIRST MESSAGE:**\n`;
            prompt += `- This is the first message in this conversation\n`;
            prompt += `- You should greet the customer warmly with "Hi [FirstName]"\n`;
            prompt += `- Ask what they need help with\n\n`;
        }

        // Check if this is actually the first AI response (even if there's an incoming message)
        const hasAISentMessage = customerContextHistory?.some(msg => msg.sentMessage);
        if (!hasAISentMessage) {
            prompt += `**🚨 CRITICAL: This is your FIRST response to the customer - you MUST greet them with "Hi [FirstName]"!**\n\n`;
        }

         prompt += `**Conversation Flow Context (for your understanding ONLY - DO NOT copy these phrases):**\n`;
         prompt += `The general conversation should progress through these topics:\n`;
         const flowSummary = [
             "1. Greet and understand if they need hospital assistance",
             "2. Check if it's urgent and which family member needs care",
             "3. Ask about the medical reason to suggest appropriate specialists",
             "4. Provide hospital recommendations with details",
             "5. Follow up on recovery and schedule consultations"
         ];
         flowSummary.forEach(flow => prompt += `${flow}\n`);
         prompt += `\n`;
         
         prompt += `**🚨 CRITICAL - FOLLOW RECOMMENDED ACTIONS EXACTLY:**\n`;
         prompt += `- You MUST follow the recommended actions from the intent configuration VERY CAREFULLY\n`;
         prompt += `- When customer replies with specific hospital name, you MUST ask: "do you seek admission or hospitalization in the hospital?"\n`;
         prompt += `- This is about HOSPITAL ADMISSION (staying in hospital for treatment)\n`;
         prompt += `- NOT about appointments or consultations for hospital selection\n`;
         prompt += `- Only mention consultations at the very end for follow-up care (after admission)\n`;
         prompt += `- Follow the exact flow: admission → claim initiation → follow-up consultation\n\n`;

         prompt += `**CRITICAL - Response Guidelines:**\n`;
         prompt += `✅ DO:\n`;
         prompt += `- READ THE CONVERSATION HISTORY THOROUGHLY - remember what customer already told you\n`;
         prompt += `- Only greet with "Hi [Name]" if this is the FIRST AI response (no previous sentMessage in history)\n`;
         prompt += `- In follow-up messages, start directly with the response - no greetings\n`;
         prompt += `- If customer sent a message but you haven't responded yet, this is your FIRST response - GREET THEM\n`;
         prompt += `- Use customer's first name occasionally and naturally in the conversation (not at the start)\n`;
         prompt += `- Write in your OWN natural, conversational words - like a real human assistant\n`;
         prompt += `- Make responses ENGAGING and PERSONALIZED - show genuine care and empathy\n`;
         prompt += `- Start conversations with warmth and concern for their health\n`;
         prompt += `- Use minimal emojis (max 1-2) and only where meaningful\n`;
         prompt += `- Use WhatsApp formatting: *bold* for emphasis, \\n for line breaks\n`;
         prompt += `- Structure messages with clear paragraphs and spacing\n`;
         prompt += `- TAKE ACTION on behalf of the customer (e.g., "I'll schedule...", "I'll coordinate...", "Let me arrange...")\n`;
         prompt += `- OFFER TO DO things for them proactively\n`;
         prompt += `- Ask questions ONLY if you don't already know the answer from conversation history\n`;
         prompt += `- Move forward in the conversation - don't go backwards\n`;
         prompt += `- Be empathetic and supportive but professional\n`;
         prompt += `- CRITICAL: If customer already told you WHO needs care (wife, son, daughter, self), NEVER ask again\n`;
         prompt += `- CRITICAL: If customer already told you WHAT medical issue, NEVER ask again\n`;
         prompt += `- CRITICAL: If customer already told you WHERE (location), NEVER ask again\n`;
         prompt += `- CRITICAL: Follow the exact recommended actions from intent configuration\n`;
         prompt += `- CRITICAL: When customer selects hospital, ask about ADMISSION, not appointments\n`;
         prompt += `- CRITICAL: When customer says YES to admission, you MUST ask for estimated cost AND date/time (MANDATORY)\n`;
        prompt += `\n`;
         prompt += `❌ DO NOT:\n`;
         prompt += `- 🚫 NEVER repeat greetings - only say "Hi [Name]" in the FIRST message, not subsequent ones\n`;
         prompt += `- 🚫 NEVER repeat questions already answered in conversation history\n`;
         prompt += `- 🚫 NEVER ask "Is this for you or family member?" if customer already told you\n`;
         prompt += `- 🚫 NEVER ask "What location?" if customer already mentioned it\n`;
         prompt += `- 🚫 NEVER ask "What medical issue?" if customer already explained\n`;
         prompt += `- 🚫 NEVER ask about "appointments" when customer selects a hospital - ask about "admission"\n`;
         prompt += `- 🚫 NEVER skip asking for estimated cost and date/time when customer confirms admission\n`;
         prompt += `- 🚫 NEVER ask for cost and date/time if you already asked and customer hasn't responded yet\n`;
         prompt += `- 🚫 NEVER ask for cost and date/time if customer has already provided this information\n`;
         prompt += `- 🚫 NEVER copy template phrases like "Hey {{customerName}} it seems like..." or "I'm glad you found the hospital locator helpful!"\n`;
         prompt += `- 🚫 NEVER use {{placeholders}} or template variables\n`;
         prompt += `- 🚫 NEVER use generic responses like "Let me know if you'd like me to find some options for you"\n`;
         prompt += `- Use formal or robotic language\n`;
         prompt += `- Overuse emojis (no more than 2 per message)\n`;
         prompt += `- Write walls of text without line breaks\n`;
         prompt += `- Ask the customer to check things themselves\n`;
         prompt += `- Ask the customer to do tasks themselves\n`;
         prompt += `- Say things like "Do you already have...", "Have you checked...", "Can you confirm..."\n`;
        prompt += `\n`;

         prompt += `**Example Conversations:**\n\n`;
 
         prompt += `Customer: "searching hospitals" or "hospital locator journey viewed"\n`;
         prompt += `❌ BAD Response: "Hey {{customerName}} it seems like you are trying to find hospitals near you. I hope everything is fine. Do you seek any addmission for any issue? I can help you with it"\n`;
         prompt += `❌ BAD Response: "I see you've been exploring the hospital locator! I hope everything is okay with you and your family. I'm here to help you find the best medical care."\n`;
         if (policyInfo) {
           const firstName = policyInfo.policyholder.split(' ')[0];
           prompt += `✅ GOOD Response: "Hi ${firstName} 👋\\n\\nI see you're looking for hospitals.\\n\\nI hope everything is okay with you and your family.\\n\\nI'm here to help you find the best medical care.\\n\\nAre you looking for admission or treatment for yourself or a family member?\\n\\nJust let me know what you need, and I'll get you connected with the right specialists and hospitals."\n\n`;
         } else {
           prompt += `✅ GOOD Response: "Hi there 👋\\n\\nI see you're looking for hospitals.\\n\\nI hope everything is okay with you and your family.\\n\\nI'm here to help you find the best medical care.\\n\\nAre you looking for admission or treatment for yourself or a family member?\\n\\nJust let me know what you need, and I'll get you connected with the right specialists and hospitals."\n\n`;
         }

         prompt += `Example 2 - Using Conversation History and Family Names:\n`;
         if (policyInfo && policyInfo.insuredMembers) {
             const spouse = policyInfo.insuredMembers.find(m => m.relationship === 'Spouse');
             if (spouse) {
                 const spouseFirstName = spouse.name.split(' ')[0];
                 prompt += `Previous: Customer said "My wife needs admission for surgery"\n`;
                 prompt += `Customer now says: "Yes, we need a hospital"\n`;
                 prompt += `❌ BAD Response: "Is this for yourself or a family member?" OR "I understand your wife needs admission..."\n`;
                 prompt += `✅ GOOD Response: "I understand *${spouseFirstName}* needs admission for surgery.\\n\\nWhat type of surgery is it?\\n\\nThis will help me find hospitals with the right specialists."\n\n`;
             }
         } else {
             prompt += `Previous: Customer said "My wife needs admission for surgery"\n`;
             prompt += `Customer now says: "Yes, we need a hospital"\n`;
             prompt += `❌ BAD Response: "Is this for yourself or a family member?"\n`;
             prompt += `✅ GOOD Response: "I understand your wife needs admission for surgery.\\n\\nWhat type of surgery is it?\\n\\nThis will help me find hospitals with the right specialists."\n\n`;
         }

         prompt += `Example 3 - PREVENTING REPEATED QUESTIONS:\n`;
         prompt += `Previous: Customer said "My wife Punita needs kidney stone treatment"\n`;
         prompt += `Customer now says: "I want to schedule admission for Monday"\n`;
         prompt += `❌ BAD Response: "Who is this admission for?" OR "What medical issue is this for?"\n`;
         prompt += `✅ GOOD Response: "Perfect! I'll coordinate *Punita's* kidney stone treatment admission for *Monday*.\\n\\nLet me arrange everything with the hospital."\n\n`;

        prompt += `Example 4 - Using Conversation History:\n`;
        prompt += `Previous: Customer said "My wife needs kidney stone treatment in Andheri"\n`;
        prompt += `Customer now says: "Show me hospitals"\n`;
        prompt += `❌ BAD Response: "Sure! What medical condition are we looking at? And which area do you prefer?"\n`;
        prompt += `✅ GOOD Response: "Let me find the best hospitals in *Andheri* with specialized *Urology* departments for kidney stone treatment.\\n\\nI'll get you the top options right away!"\n\n`;

        prompt += `Example 5 - Hospital Selection (Following Intent Configuration):\n`;
        prompt += `Customer: "I want Seven Star Hospital"\n`;
        prompt += `❌ BAD Response: "Would you like me to schedule an appointment at Seven Star Hospital?"\n`;
        prompt += `✅ GOOD Response: "Sure I can help you with that with some more details about that hospital. Do you seek admission or hospitalization in the hospital?"\n\n`;
        
        prompt += `Example 6 - After Customer Says Yes to Admission (MANDATORY):\n`;
        prompt += `Customer: "Yes, I need admission"\n`;
        prompt += `❌ BAD Response: "Perfect! I'll help you with the admission process."\n`;
        prompt += `✅ GOOD Response: "I will help you with the admission process.\\n\\nPlease provide:\\n- *Estimated cost* of treatment\\n- *Date and time* of admission\\n\\nThis information is required to proceed."\n\n`;
        
        prompt += `Example 7 - After Customer Provides Date/Time:\n`;
        prompt += `Customer: "I want admission on Monday, estimated cost is 50,000"\n`;
        prompt += `❌ BAD Response: "Great! Let me know if you need anything else."\n`;
        prompt += `✅ GOOD Response: "Ok noted I'll coordinate with the hospital for your admission on *Monday*.\\n\\nPlease provide me with any specific requirements or preferences you may have for your stay at the hospital."\n\n`;

        prompt += `Example - NO REPEATED GREETINGS:\n`;
        prompt += `Message 1 (first contact): "Hi Vineet 👋\\n\\nI can help you find the right hospital..."\n`;
        prompt += `Message 2 (after customer replies): ❌ "Hi Vineet! Let me help..." ✅ "I understand you need help for Punita. What type of medical care..."\n`;
        prompt += `Message 3 (after customer replies): ❌ "Hi Vineet! Here are..." ✅ "Great! I found excellent hospitals for kidney stone treatment..."\n`;
        prompt += `Message 4 (after customer replies): ❌ "Hi! Thanks for choosing..." ✅ "Perfect! I'll coordinate Punita's admission..."\n`;
        prompt += `**Rule: Greet ONLY in the first message. All subsequent messages jump straight to the content.**\n\n`;

        // Include hospital data if available
        if (contextPayload.hospitalData && contextPayload.hospitalData.hospitals && contextPayload.hospitalData.hospitals.length > 0) {
            prompt += `**🏥 AVAILABLE HOSPITALS (Use this data in your response):**\n\n`;
            prompt += `Department: ${contextPayload.hospitalData.department}\n`;
            prompt += `Location: ${contextPayload.hospitalData.location}\n\n`;
            prompt += `✅ **ALL THESE HOSPITALS ARE IN YOUR TATA AIG INSURANCE NETWORK** - You can get cashless treatment!\n\n`;
            prompt += `Here are the top hospitals with ${contextPayload.hospitalData.department} department:\n\n`;

            contextPayload.hospitalData.hospitals.forEach((hospital, index) => {
                prompt += `${index + 1}. **${hospital.hospitalName}**\n`;
                prompt += `   📍 Address: ${hospital.hospitalAddress}\n`;
                prompt += `   🏙️ City: ${hospital.city}, ${hospital.state}\n`;
                prompt += `   📮 Pincode: ${hospital.pincode}\n`;
                if (hospital.departments && hospital.departments.length > 0) {
                    prompt += `   🏥 Key Departments: ${hospital.departments.slice(0, 5).join(', ')}\n`;
                }
                prompt += `\n`;
            });

            prompt += `**IMPORTANT INSTRUCTIONS FOR HOSPITAL RECOMMENDATIONS:**\n`;
            prompt += `- Present hospitals in a clear, well-structured WhatsApp format\n`;
            prompt += `- DO NOT ask if hospitals are in network - they ALL are already covered under Tata AIG\n`;
            prompt += `- Emphasize the cashless treatment benefit\n`;
            prompt += `- Use *bold* for hospital names and key information\n`;
            prompt += `- Use line breaks (\\n) to separate each hospital\n`;
            prompt += `- Keep it professional but warm\n\n`;
            const firstName = policyInfo ? policyInfo.policyholder.split(' ')[0] : '[Name]';
            prompt += `**Example Format:**\n`;
            prompt += `"Hi ${firstName},\\n\\nI've found excellent hospitals with specialized *${contextPayload.hospitalData.department}* departments near ${contextPayload.hospitalData.location}. All of them are covered under your *Tata AIG insurance* for cashless treatment. ✅\\n\\n`;
            prompt += `Here are my top recommendations:\\n\\n`;
            prompt += `*1. [Hospital Name]*\\nLocation: [Area details]\\nSpecialties: [Key departments]\\n\\n`;
            prompt += `*2. [Hospital Name]*\\nLocation: [Area details]\\nSpecialties: [Key departments]\\n\\n`;
            prompt += `...continue for all hospitals...\\n\\n`;
            prompt += `Would you like me to schedule an appointment at any of these hospitals?"\n\n`;
        }

         prompt += `**FINAL REMINDER - WHATSAPP FORMATTING:**\n`;
         prompt += `- ALWAYS use \\n\\n for paragraph breaks\n`;
         prompt += `- ALWAYS use \\n for line breaks within sentences\n`;
         prompt += `- ALWAYS use *bold* for important information\n`;
         prompt += `- NEVER write long paragraphs\n`;
         prompt += `- Keep sentences short and readable on mobile\n`;
         prompt += `- Structure information with clear breaks\n\n`;
         
         prompt += `Now, respond to the customer's message below in your own natural, warm, and engaging way with proper WhatsApp formatting:`;

         return prompt;
    }

    /**
     * Get conversation history for a customer
     * @param {string} customerId - Customer ID
     * @returns {Array} - Conversation history
     */
    getConversationHistory(customerId) {
        const journeyData = this.customerJourneys.get(customerId);
        if (!journeyData) {
            return [];
        }
        return this.conversationHistories.get(journeyData.conversationId) || [];
    }

    /**
     * Get active journey for a customer
     * @param {string} customerId - Customer ID
     * @returns {Object|null} - Journey data
     */
    getActiveJourney(customerId) {
        return this.customerJourneys.get(customerId) || null;
    }

    /**
     * Check if hospital data is needed and fetch it
     * @param {string} query - Current query
     * @param {Array} conversationHistory - Conversation history
     * @returns {Promise<Object|null>} - Hospital data or null
     */
    async checkAndFetchHospitalData(query, conversationHistory) {
        try {
            // Check if query is about finding/searching hospitals
            const hospitalKeywords = ['hospital', 'hospitals', 'admission', 'treatment', 'doctor', 'medical', 'surgery', 'specialist'];
            const needsHospitals = hospitalKeywords.some(keyword =>
                query.toLowerCase().includes(keyword)
            );

            // Also check conversation history for medical conditions or requests
            const fullConversation = conversationHistory.map(msg =>
                msg.incommingMessage || msg.sentMessage || ''
            ).join(' ').toLowerCase();

            const hasMedicalContext = fullConversation.includes('hospital') ||
                fullConversation.includes('admission') ||
                fullConversation.includes('treatment');

            if (!needsHospitals && !hasMedicalContext) {
                return null;
            }

            // Extract department and location from query and history
            const extractionResult = await this.extractDepartmentAndLocation(query, conversationHistory);

            if (!extractionResult.department) {
                // If no department identified yet, return null (will ask customer for more info)
                return null;
            }

            console.log(`Searching hospitals for department: ${extractionResult.department}, location: ${extractionResult.location}`);

            // Search hospitals by department
            const hospitals = await this.searchHospitalsByDepartment(
                extractionResult.department,
                extractionResult.location
            );

            if (hospitals && hospitals.length > 0) {
                return {
                    department: extractionResult.department,
                    location: extractionResult.location,
                    hospitals: hospitals.slice(0, 5) // Top 5 hospitals
                };
            }

            return null;

        } catch (error) {
            console.error('Error checking/fetching hospital data:', error);
            return null;
        }
    }

    /**
     * Extract department/specialty and location from conversation
     * @param {string} query - Current query
     * @param {Array} conversationHistory - Conversation history
     * @returns {Promise<Object>} - {department, location}
     */
    async extractDepartmentAndLocation(query, conversationHistory) {
        try {
            // Get full conversation context
            const fullConversation = conversationHistory.map(msg =>
                msg.incommingMessage || msg.sentMessage || ''
            ).join('\n') + '\n' + query;

            // Use Gemini to extract department and location
            const extractionPrompt = `Analyze this conversation and extract:
1. Medical department/specialty needed (e.g., Cardiology, Urology, Orthopedics, etc.)
2. Location mentioned (city/area name)

Conversation:
${fullConversation}

Respond in JSON format:
{
  "department": "department name or null",
  "location": "location name or null"
}

Only respond with the JSON, nothing else.`;

            const response = await this.geminiService.model.generateContent({
                contents: [{ role: 'user', parts: [{ text: extractionPrompt }] }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 200
                }
            });

            const responseText = response.response.text().trim();
            // Extract JSON from response (handle markdown code blocks)
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const extracted = JSON.parse(jsonMatch[0]);
                return {
                    department: extracted.department,
                    location: extracted.location || 'Mumbai' // Default to Mumbai
                };
            }

            return { department: null, location: 'Mumbai' };

        } catch (error) {
            console.error('Error extracting department and location:', error);
            return { department: null, location: 'Mumbai' };
        }
    }

    /**
     * Search hospitals by department
     * @param {string} department - Medical department/specialty
     * @param {string} location - Location (city/area)
     * @returns {Promise<Array>} - Array of hospitals
     */
    async searchHospitalsByDepartment(department, location) {
        try {
            if (!this.hospitalService) {
                console.warn('Hospital service not available');
                return [];
            }

            // Load hospital data
            const hospitalsPath = path.join(__dirname, '../../data/HospitalData.json');
            const allHospitals = JSON.parse(fs.readFileSync(hospitalsPath, 'utf8'));

            // Filter hospitals by department
            const matchingHospitals = allHospitals.filter(hospital => {
                if (!hospital.departments || !Array.isArray(hospital.departments)) {
                    return false;
                }
                // Case-insensitive match for department
                return hospital.departments.some(dept =>
                    dept.toLowerCase().includes(department.toLowerCase()) ||
                    department.toLowerCase().includes(dept.toLowerCase())
                );
            });

            // If location specified (and not just Mumbai), filter by location
            if (location && location.toLowerCase() !== 'mumbai') {
                const locationFiltered = matchingHospitals.filter(hospital => {
                    const address = (hospital.hospitalAddress || '').toLowerCase();
                    const city = (hospital.city || '').toLowerCase();
                    const locationLower = location.toLowerCase();
                    return address.includes(locationLower) || city.includes(locationLower);
                });

                // If we found location matches, use them; otherwise use all matching
                if (locationFiltered.length > 0) {
                    return locationFiltered.slice(0, 5);
                }
            }

            // Return top 5 hospitals
            return matchingHospitals.slice(0, 5);

        } catch (error) {
            console.error('Error searching hospitals by department:', error);
            return [];
        }
    }

    /**
     * Initiate claim for hospital admission
     * @param {string} conversationId - Conversation ID
     * @param {string} customerId - Customer ID
     * @param {string} response - AI response
     * @param {Array} scheduledMessages - Messages to schedule after claim initiation (optional)
     */
    async initiateClaimForAdmission(conversationId, customerId, response, scheduledMessages = []) {
        try {
            console.log('🏥 Initiating claim for hospital admission...');

            // Get conversation history to extract information
            const conversationHistory = this.conversationHistories.get(conversationId) || [];
            const fullConversation = conversationHistory.map(msg =>
                msg.incommingMessage || msg.sentMessage || ''
            ).join('\n') + '\n' + response;

            // Extract hospital name from customer's most recent selection in conversation history
            let hospitalName = null;
            
            // First, try to find hospital name in customer's incoming messages (most recent first)
            const reversedHistory = [...conversationHistory].reverse();
            for (const msg of reversedHistory) {
                if (msg.incommingMessage) {
                    // Check if customer mentioned a hospital name
                    const customerMessage = msg.incommingMessage.toLowerCase();
                    
                    // Load hospitals to check against
                    const hospitalsPath = path.join(__dirname, '../../data/HospitalData.json');
                    const allHospitals = JSON.parse(fs.readFileSync(hospitalsPath, 'utf8'));
                    
                    // Find if any hospital name is mentioned in the customer's message
                    // Prioritize unique identifiers over common words like "hospital", "centre", etc.
                    for (const hospital of allHospitals) {
                        const hospName = hospital.hospitalName.toLowerCase();
                        
                        // Split into words and filter out common terms
                        const commonWords = ['hospital', 'centre', 'center', 'multispeciality', 'multi-speciality', 
                                           'speciality', 'specialty', 'research', 'healthcare', 'managed', 'care'];
                        const hospWords = hospName.split(/[\s()&,]+/)
                            .filter(w => w.length > 3 && !commonWords.includes(w));
                        
                        // Check if customer mentioned any unique identifier from this hospital
                        if (hospWords.length > 0 && hospWords.some(word => customerMessage.includes(word))) {
                            hospitalName = hospital.hospitalName;
                            console.log('✅ Found hospital from customer message:', hospitalName);
                            console.log('   Matched on unique identifier:', hospWords.find(w => customerMessage.includes(w)));
                            break;
                        }
                    }
                    
                    if (hospitalName) break;
                }
            }
            
            // Fallback: Extract from AI's response if not found in customer messages
            if (!hospitalName) {
                const hospitalMatch = response.match(/\*([^*]*[Hh]ospital[^*]*)\*/);
                hospitalName = hospitalMatch ? hospitalMatch[1] : null;
                console.log('⚠️ Extracted hospital from AI response:', hospitalName);
            }

            // Extract date from customer's messages (most recent first)
            let dateOfAdmission = null;
            let dateString = null;
            
            for (const msg of reversedHistory) {
                if (msg.incommingMessage) {
                    const customerMessage = msg.incommingMessage.toLowerCase();
                    
                    // Look for date patterns in customer message
                    const datePatterns = [
                        /(\d{1,2})\s*(?:oct|october)/i,
                        /(\d{1,2})\s*(?:nov|november)/i,
                        /(\d{1,2})\s*(?:dec|december)/i,
                        /(\d{1,2})\s*(?:jan|january)/i,
                        /(\d{1,2})\s*(?:feb|february)/i,
                        /(\d{1,2})\s*(?:mar|march)/i,
                        /(\d{1,2})\s*(?:apr|april)/i,
                        /(\d{1,2})\s*(?:may)/i,
                        /(\d{1,2})\s*(?:jun|june)/i,
                        /(\d{1,2})\s*(?:jul|july)/i,
                        /(\d{1,2})\s*(?:aug|august)/i,
                        /(\d{1,2})\s*(?:sep|september)/i,
                        /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
                        /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/
                    ];
                    
                    for (const pattern of datePatterns) {
                        const match = msg.incommingMessage.match(pattern);
                        if (match) {
                            dateString = match[0];
                            console.log('✅ Found date from customer message:', dateString);
                            break;
                        }
                    }
                    
                    if (dateString) break;
                }
            }
            
            // Fallback: Extract from AI response if not found in customer messages
            if (!dateString) {
                const dateMatch = response.match(/\*([^*]*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|[0-9]{1,2}[/-][0-9]{1,2})[^*]*)\*/);
                if (dateMatch) {
                    dateString = dateMatch[1];
                    console.log('⚠️ Extracted date from AI response:', dateString);
                }
            }
            
            // Parse the date string to DD-MM-YYYY format
            if (dateString) {
                dateOfAdmission = this.parseDateForClaim(dateString);
                console.log('📅 Final date of admission:', dateOfAdmission);
            }

            // Extract diagnosis/medical issue from conversation
            const diagnosis = await this.extractDiagnosisFromConversation(fullConversation);

            // Find selected hospital data
            let selectedHospital = null;
            if (hospitalName) {
                console.log('🔍 Searching for hospital:', hospitalName);
                const hospitalsPath = path.join(__dirname, '../../data/HospitalData.json');
                const allHospitals = JSON.parse(fs.readFileSync(hospitalsPath, 'utf8'));
                
                // Try multiple matching strategies
                selectedHospital = allHospitals.find(h => {
                    const dbName = h.hospitalName.toLowerCase();
                    const searchName = hospitalName.toLowerCase();
                    
                    // Exact match
                    if (dbName === searchName) return true;
                    
                    // Contains match (both directions)
                    if (dbName.includes(searchName) || searchName.includes(dbName)) return true;
                    
                    // Partial word match (split by spaces)
                    const searchWords = searchName.split(' ').filter(w => w.length > 2);
                    const dbWords = dbName.split(' ').filter(w => w.length > 2);
                    
                    return searchWords.some(word => dbWords.some(dbWord => 
                        dbWord.includes(word) || word.includes(dbWord)
                    ));
                });
                
                console.log('🔍 Hospital search result:', selectedHospital ? selectedHospital.hospitalName : 'NOT FOUND');
                
                // If still not found, try a more flexible search
                if (!selectedHospital) {
                    console.log('🔍 Trying flexible search...');
                    const searchWords = hospitalName.toLowerCase().split(' ').filter(w => w.length > 2);
                    selectedHospital = allHospitals.find(h => {
                        const dbName = h.hospitalName.toLowerCase();
                        return searchWords.some(word => dbName.includes(word));
                    });
                    console.log('🔍 Flexible search result:', selectedHospital ? selectedHospital.hospitalName : 'STILL NOT FOUND');
                }
            }

            // Find which family member needs admission
            let memberRelation = 'Self';
            const conversationLower = fullConversation.toLowerCase();
            if (conversationLower.includes('my wife') || conversationLower.includes('wife')) {
                memberRelation = 'Spouse';
            } else if (conversationLower.includes('my son')) {
                memberRelation = 'Son';
            } else if (conversationLower.includes('my daughter')) {
                memberRelation = 'Daughter';
            }

            // Build claim data
            const userInputs = {
                dateOfAdmission: dateOfAdmission || this.getTodayDate(),
                diagnosis: diagnosis || 'Medical treatment',
                estimatedCost: '50000', // Default estimate
                memberRelation: memberRelation,
                mobileNumber: '9830323302', // From customer ID or policy
                emailId: 'customer@tataaig.com',
                communicationAddress: '6TH FLOOR, UNITECH CYBER PARK TOWER-C',
                communicationCity: 'Mumbai',
                communicationPincode: '400001',
                memberGender: memberRelation === 'Spouse' ? 'Female' : 'Male'
            };

            const hospitalData = selectedHospital ? {
                hospitalName: selectedHospital.hospitalName,
                hospitalAddress: selectedHospital.hospitalAddress,
                hospitalAddressLine2: selectedHospital.city,
                city: selectedHospital.city,
                hospitalCityTownVillage: selectedHospital.city,
                zone: selectedHospital.zone,
                state: selectedHospital.state,
                hospitalState: selectedHospital.state,
                pincode: selectedHospital.pincode,
                hospitalPincode: selectedHospital.pincode,
                hospitalCountry: 'INDIA'
            } : null;

            if (!hospitalData) {
                console.log('⚠️ Hospital data not found - cannot initiate claim');
                return { success: false, message: 'Hospital not found' };
            }

            // Build and initiate claim
            const claimData = this.claimInitiationService.buildClaimData(
                this.policyInfo,
                userInputs,
                hospitalData
            );

            console.log('Initiating claim with data:', {
                hospital: hospitalData.hospitalName,
                member: memberRelation,
                date: userInputs.dateOfAdmission,
                diagnosis: userInputs.diagnosis
            });

            // Initiate claim asynchronously (fire and forget)
            const customerName = this.policyInfo ? this.policyInfo.policyholder.split(' ')[0] : 'there';
            const familyMemberName = memberRelation !== 'Self' && this.policyInfo ?
                this.policyInfo.insuredMembers?.find(m => m.relationship === memberRelation)?.name.split(' ')[0] : null;

            this.claimInitiationService.initiateClaim(claimData)
                .then(result => {
                    if (result.success && result.data && result.data.data) {
                        console.log('✅ Claim initiated successfully!', result.data);

                        // Extract intimation ID from response
                        const intimationId = result.data.data.intimationId;
                        const requestId = result.data.data.requestId;

                        // Send WhatsApp notification to customer with intimation ID
                        const notificationMessage = this.buildClaimConfirmationMessage(
                            customerName,
                            familyMemberName,
                            intimationId,
                            requestId,
                            hospitalData.hospitalName
                        );

                        console.log('Sending claim confirmation via WhatsApp...');
                        this.communicationService.sendMessage(notificationMessage)
                            .then(() => {
                                console.log('✅ Claim confirmation sent via WhatsApp');

                                // NOW SCHEDULE FOLLOW-UP MESSAGES AFTER INTIMATION ID IS SENT
                                if (scheduledMessages && scheduledMessages.length > 0) {
                                    console.log(`📅 Scheduling ${scheduledMessages.length} follow-up messages now that intimation ID is confirmed`);

                                    // Update context with actual intimation ID and request ID
                                    const updatedMessages = scheduledMessages.map(msg => ({
                                        ...msg,
                                        text: msg.text
                                            .replace(/{{claim Number}}/g, intimationId)
                                            .replace(/{{intimationId}}/g, intimationId)
                                            .replace(/{{requestId}}/g, requestId)
                                    }));

                                    this.schedulingAgent.scheduleMessages(
                                        conversationId,
                                        customerId,
                                        updatedMessages
                                    );

                                    console.log('✅ Follow-up messages scheduled successfully');
                                }
                            })
                            .catch(err => console.error('Error sending claim confirmation:', err));

                    } else {
                        console.log('❌ Claim initiation failed:', result.error);
                        console.log('⚠️ Skipping scheduled messages due to claim initiation failure');
                    }
                })
                .catch(error => {
                    console.error('Error in claim initiation:', error);
                    console.log('⚠️ Skipping scheduled messages due to claim initiation error');
                });

            // Return immediately without waiting
            return { success: true, message: 'Claim initiation in progress' };

        } catch (error) {
            console.error('Error initiating claim for admission:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Build claim confirmation message for WhatsApp
     * @param {string} customerName - Customer's first name
     * @param {string} familyMemberName - Family member's name (if applicable)
     * @param {string} intimationId - Intimation ID from claim API
     * @param {string} requestId - Request ID from claim API
     * @param {string} hospitalName - Hospital name
     * @returns {string} - Formatted WhatsApp message
     */
    buildClaimConfirmationMessage(customerName, familyMemberName, intimationId, requestId, hospitalName) {
        const patientName = familyMemberName || customerName;

        return `Hi ${customerName}! ✅\n\nGreat news! The claim has been initiated successfully for ${patientName}'s admission at *${hospitalName}*.\n\n*Intimation ID:* ${intimationId}\n*Request ID:* ${requestId}\n\nYou can use this intimation ID for all future correspondence regarding this claim. The hospital has been notified and your cashless treatment is confirmed.\n\nIf you need any assistance, I'm here to help!`;
    }

    /**
     * Parse date string to DD-MM-YYYY format
     * @param {string} dateStr - Date string (can be day name or date)
     * @returns {string} - Date in DD-MM-YYYY format
     */
    parseDateForClaim(dateStr) {
        try {
            const today = new Date();
            const dateLower = dateStr.toLowerCase();
            
            // Month name mapping
            const monthNames = {
                'jan': 0, 'january': 0,
                'feb': 1, 'february': 1,
                'mar': 2, 'march': 2,
                'apr': 3, 'april': 3,
                'may': 4,
                'jun': 5, 'june': 5,
                'jul': 6, 'july': 6,
                'aug': 7, 'august': 7,
                'sep': 8, 'september': 8,
                'oct': 9, 'october': 9,
                'nov': 10, 'november': 10,
                'dec': 11, 'december': 11
            };
            
            // Try to parse "16 oct" or "16 october" format
            const monthMatch = dateLower.match(/(\d{1,2})\s*(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october|nov|november|dec|december)/i);
            if (monthMatch) {
                const day = parseInt(monthMatch[1]);
                const monthStr = dateLower.match(/(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october|nov|november|dec|december)/i)[0];
                const month = monthNames[monthStr];
                
                const targetDate = new Date(today.getFullYear(), month, day);
                
                // If the date is in the past, assume next year
                if (targetDate < today) {
                    targetDate.setFullYear(today.getFullYear() + 1);
                }
                
                const dayStr = String(targetDate.getDate()).padStart(2, '0');
                const monthStr2 = String(targetDate.getMonth() + 1).padStart(2, '0');
                const year = targetDate.getFullYear();
                
                return `${dayStr}-${monthStr2}-${year}`;
            }

            // Map day names to dates
            const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            let targetDate = new Date();

            dayNames.forEach((day, index) => {
                if (dateLower.includes(day)) {
                    const currentDay = today.getDay();
                    const daysToAdd = (index - currentDay + 7) % 7 || 7;
                    targetDate = new Date(today);
                    targetDate.setDate(today.getDate() + daysToAdd);
                }
            });

            // Format to DD-MM-YYYY
            const day = String(targetDate.getDate()).padStart(2, '0');
            const month = String(targetDate.getMonth() + 1).padStart(2, '0');
            const year = targetDate.getFullYear();

            return `${day}-${month}-${year}`;
        } catch (error) {
            console.error('Error parsing date:', error);
            return this.getTodayDate();
        }
    }

    /**
     * Get today's date in DD-MM-YYYY format
     * @returns {string} - Today's date
     */
    getTodayDate() {
        const today = new Date();
        const day = String(today.getDate()).padStart(2, '0');
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const year = today.getFullYear();
        return `${day}-${month}-${year}`;
    }

    /**
     * Extract diagnosis/medical issue from conversation
     * @param {string} conversation - Full conversation text
     * @returns {Promise<string>} - Extracted diagnosis
     */
    async extractDiagnosisFromConversation(conversation) {
        try {
            const extractionPrompt = `Extract the medical condition or diagnosis from this conversation.

Conversation:
${conversation}

Respond with ONLY the medical condition/diagnosis (e.g., "kidney stone", "chest pain", "diabetes", etc.). 
If no specific condition is mentioned, respond with "Medical treatment".

Your response (medical condition only):`;

            const response = await this.geminiService.model.generateContent({
                contents: [{ role: 'user', parts: [{ text: extractionPrompt }] }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 50
                }
            });

            const diagnosis = response.response.text().trim();
            return diagnosis || 'Medical treatment';

        } catch (error) {
            console.error('Error extracting diagnosis:', error);
            return 'Medical treatment';
        }
    }

    /**
     * Detect if follow-up messages should be scheduled based on the response
     * @param {string} response - AI response text
     * @param {string} conversationId - Conversation ID
     * @param {string} customerId - Customer ID
     * @param {string} intentName - Intent name
     * @param {string} query - Customer query
     * @returns {Promise<Object>} - Scheduling result
     */
    async detectAndScheduleFollowUps(response, conversationId, customerId, intentName, query) {
        try {
            // Get intent configuration
            const intentConfig = this.getIntentConfig(intentName);
            if (!intentConfig || !intentConfig.recomendedAction) {
                return { scheduled: false, message: 'No intent config found' };
            }

            // IMPORTANT: Check if AI agent is taking CONFIRMED action (not just offering)
            // Distinguish between different types of scheduling
            const responseLower = response.toLowerCase();

            // Check if this is about tele-consultation (should NOT trigger hospital admission follow-ups)
            const isTeleConsultation =
                responseLower.includes('tele-consultation') ||
                responseLower.includes('teleconsultation') ||
                responseLower.includes('follow-up consultation') ||
                responseLower.includes('consultation with') ||
                responseLower.includes('doctor will call');

            if (isTeleConsultation) {
                console.log('This is a tele-consultation scheduling - NOT hospital admission. Skipping admission follow-ups.');
                return { scheduled: false, message: 'Tele-consultation - different flow' };
            }

            // Check for HOSPITAL ADMISSION coordination (very specific)
            const isHospitalAdmission =
                (
                    (
                        (
                            responseLower.includes('coordinate') ||
                            responseLower.includes('arrange') ||
                            responseLower.includes('help you with admission') ||
                            responseLower.includes('assist with admission') ||
                            responseLower.includes('support your admission') ||
                            responseLower.includes('organize admission') ||
                            responseLower.includes('make admission arrangements')
                        ) &&
                        responseLower.includes('admission at') ||
                        responseLower.includes('admission for') ||
                        responseLower.includes('admission to') ||
                        responseLower.includes('admission as soon') ||
                        responseLower.includes('hospital admission') ||
                        responseLower.includes('get you admitted') ||
                        responseLower.includes('help you get admitted') ||
                        responseLower.includes('arrange your admission')
                    ) ||
                    responseLower.includes("i'll send you a confirmation") ||
                    responseLower.includes('i will send you a confirmation') ||
                    responseLower.includes("i'll be in touch") ||
                    responseLower.includes('i will be in touch') ||
                    responseLower.includes("i'll coordinate") ||
                    responseLower.includes('i will coordinate') ||
                    responseLower.includes("i'll arrange your admission") ||
                    responseLower.includes('we will arrange your admission') ||
                    responseLower.includes('we will coordinate your admission') ||
                    responseLower.includes('we will help you with hospital admission') ||
                    responseLower.includes('we’ll help you with admission') ||
                    responseLower.includes('will confirm your admission') ||
                    responseLower.includes('will reach out to confirm admission') ||
                    responseLower.includes('our team will contact you for admission') ||
                    responseLower.includes('hospital team will connect') ||
                    responseLower.includes('you’ll get a call for admission') ||
                    responseLower.includes('we will contact you shortly for admission')
                ) &&
                !responseLower.includes('consultation');

            // Check if CUSTOMER has selected a specific hospital in their recent messages
            const conversationHistory = this.conversationHistories.get(conversationId) || [];
            let customerSelectedHospital = false;
            
            // Load actual hospital data dynamically
            const hospitalsPath = path.join(__dirname, '../../data/HospitalData.json');
            const allHospitals = JSON.parse(fs.readFileSync(hospitalsPath, 'utf8'));
            
            // Check last 3 customer messages for hospital selection
            const reversedHistory = [...conversationHistory].reverse();
            let recentCustomerMessages = 0;
            
            for (const msg of reversedHistory) {
                if (msg.incommingMessage) {
                    recentCustomerMessages++;
                    const customerMessage = msg.incommingMessage.toLowerCase();
                    
                    // Check if customer mentioned ANY hospital from our database
                    for (const hospital of allHospitals) {
                        const hospName = hospital.hospitalName.toLowerCase();
                        
                        // Filter out common words and get unique identifiers
                        const commonWords = ['hospital', 'centre', 'center', 'multispeciality', 'multi-speciality', 
                                           'speciality', 'specialty', 'research', 'healthcare', 'managed', 'care'];
                        const hospWords = hospName.split(/[\s()&,]+/)
                            .filter(w => w.length > 3 && !commonWords.includes(w));
                        
                        // Check if customer mentioned any unique identifier from this hospital
                        if (hospWords.length > 0 && hospWords.some(word => customerMessage.includes(word))) {
                            customerSelectedHospital = true;
                            console.log('✅ Customer selected hospital in message:', msg.incommingMessage);
                            console.log('   Matched hospital:', hospital.hospitalName);
                            break;
                        }
                    }
                    
                    if (customerSelectedHospital) break;
                    
                    // Only check last 3 customer messages
                    if (recentCustomerMessages >= 3) break;
                }
            }

            // For scheduling to trigger, we need:
            // 1. AI coordinating HOSPITAL ADMISSION (not consultation)
            // 2. Customer has explicitly selected a hospital
            const isActualAdmissionScheduled = isHospitalAdmission && customerSelectedHospital;

            if (!isActualAdmissionScheduled) {
                console.log('Hospital admission not ready for scheduling yet. Conditions:', {
                    isHospitalAdmission,
                    customerSelectedHospital,
                    isTeleConsultation
                });
                console.log('Skipping scheduling - waiting for customer to select a specific hospital.');
                return { scheduled: false, message: 'Waiting for customer hospital selection' };
            }

            console.log('✅ AI is coordinating HOSPITAL ADMISSION with specific hospital - initiating claim');

            // Extract scheduled messages from recommended actions (to be scheduled after claim initiation)
            const scheduledMessages = [];
            intentConfig.recomendedAction.forEach((action, index) => {
                // Check for "schedule messagae:" or "schedule message:" prefix (handling typo)
                if (action.toLowerCase().startsWith('schedule messagae:') ||
                    action.toLowerCase().startsWith('schedule message:')) {

                    // Extract the message text (remove the prefix)
                    let messageText = action.replace(/^schedule messagae:/i, '').trim();
                    messageText = messageText.replace(/^schedule message:/i, '').trim();

                    scheduledMessages.push({
                        text: messageText,
                        delayInSeconds: 10 // 10 seconds delay between each message
                    });
                }
            });

            // If no scheduled messages found, return
            if (scheduledMessages.length === 0) {
                return { scheduled: false, message: 'No scheduled messages in intent' };
            }

            // Check if messages have already been scheduled for this conversation
            const existingScheduled = this.schedulingAgent.getScheduledMessages(conversationId);
            if (existingScheduled && existingScheduled.length > 0) {
                console.log('Messages already scheduled for this conversation - skipping duplicate scheduling');
                return { scheduled: false, message: 'Already scheduled' };
            }

            console.log(`Found ${scheduledMessages.length} scheduled messages - AI is taking action, scheduling now`);

            // Prepare context for placeholder replacement
            const customerName = this.policyInfo ? this.policyInfo.policyholder.split(' ')[0] : 'there';

            // Extract date/time from response if mentioned
            const dateMatch = response.match(/\*([^*]*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|[0-9]{1,2}[/-][0-9]{1,2})[^*]*)\*/);
            const date = dateMatch ? dateMatch[1] : null;

            // Extract hospital name from conversation history if available (reuse conversationHistory from above)
            let hospitalName = null;
            conversationHistory.forEach(msg => {
                const text = msg.incommingMessage || msg.sentMessage || '';
                const hospitalMatch = text.match(/\*([^*]*[Hh]ospital[^*]*)\*/);
                if (hospitalMatch) {
                    hospitalName = hospitalMatch[1];
                }
            });

            const context = {
                customerName: customerName,
                'hospital name': hospitalName || 'the hospital',
                'date and time': date || 'your scheduled date',
                'claim Number': '4300002322', // Static for now
                'claim amount': 'Rs 430067' // Static for now
            };

            // Replace placeholders in scheduled messages
            const processedMessages = scheduledMessages.map(msg => ({
                ...msg,
                text: this.replacePlaceholdersInMessage(msg.text, context)
            }));

            // INITIATE CLAIM AND SCHEDULE MESSAGES AFTER SUCCESS
            // Pass processed messages to claim initiation - they'll be scheduled after intimation ID is generated
            await this.initiateClaimForAdmission(conversationId, customerId, response, processedMessages);

            return {
                scheduled: 'pending',
                message: 'Messages will be scheduled after claim initiation completes',
                messageCount: processedMessages.length
            };

        } catch (error) {
            console.error('Error detecting/scheduling follow-ups:', error);
            return { scheduled: false, error: error.message };
        }
    }

    /**
     * Replace placeholders in message text
     * @param {string} text - Message text with placeholders
     * @param {Object} context - Context data
     * @returns {string} - Text with placeholders replaced
     */
    replacePlaceholdersInMessage(text, context) {
        let result = text;
        Object.keys(context).forEach(key => {
            const placeholder = `{{${key}}}`;
            if (result.includes(placeholder)) {
                result = result.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), context[key]);
            }
        });
        return result;
    }

    /**
     * Close/end a journey
     * @param {string} customerId - Customer ID
     * @returns {boolean} - Success status
     */
    closeJourney(customerId) {
        const journeyData = this.customerJourneys.get(customerId);
        if (journeyData) {
            journeyData.status = 'closed';
            journeyData.closedAt = new Date().toISOString();
            // Keep history but mark as closed
            return true;
        }
        return false;
    }

    /**
     * Clear conversation history (for testing/debugging)
     * @param {string} customerId - Customer ID
     */
    clearConversationHistory(customerId) {
        const journeyData = this.customerJourneys.get(customerId);
        if (journeyData) {
            this.conversationHistories.delete(journeyData.conversationId);
            this.customerJourneys.delete(customerId);
        }
    }
}

module.exports = IntentJourneyService;

