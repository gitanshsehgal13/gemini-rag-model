/**
 * Conversation Orchestrator
 * Manages conversation state and flow based on stage definitions
 */

class ConversationOrchestrator {
    constructor(intentConfig) {
        this.intentConfig = intentConfig;
        this.conversationFlow = intentConfig.conversationFlow;
        this.stages = new Map();

        // Index stages by ID for quick lookup
        this.conversationFlow.stages.forEach(stage => {
            this.stages.set(stage.id, stage);
        });
    }

    /**
     * System prompts that apply to all intents and stages
     */
    getSystemPrompts() {
        return `**Your RULES:**

1. **Role & Tone:** You are a Proactive TATA AIG Health Insurance Claim Concierge AI . Be professional, empathetic, and supportive. Prioritize clarity and conciseness. Acknowledge the user's message before transitioning to the next step. Assume the user may be stressed and avoid overly formal language. Never greet again after the first message in a session.
2. **Formatting:** All responses must be formatted for WhatsApp. Use *bold* for key names or action items. Use line breaks (\\n) to improve readability.
3. **Emoji Usage:** Use 1-2 relevant emojis sparingly when they add warmth or clarity (e.g., 🏥 for hospitals, ✅ for confirmation, 📋 for forms, 💰 for costs 👋 for greetings). Avoid overuse - emojis should enhance, not distract from the message. these emojis are just for refrence
4. **Policy Data:** Whenever possible, use the *actual names* of family members (Vineet, Punita, Aradhya, Akshat) instead of generic roles (e.g., use 'Punita' instead of 'your wife').
5. **Process Focus:** Always guide the customer to the immediate next required step in the TATA AIG claims process. Do not jump ahead or discuss steps not yet relevant.
6. **Conversation History:** If we have recent conversation history, use it to understand context and references (like "this process", "that", "it", etc.).
7. DON'T repeat questions already answered above. DON'T greet again (only greet in first message). Use info from history (who, what, where mentioned)`;
    }

    /**
     * Get current stage based on conversation state
     * @param {Object} conversationState - Current conversation state
     * @returns {Object} - Current stage definition
     */
    getCurrentStage(conversationState) {
        const { currentStageId, collectedData } = conversationState;

        // If no stage set, start with first stage
        if (!currentStageId) {
            return this.stages.get('greeting');
        }

        const currentStage = this.stages.get(currentStageId);
        if (!currentStage) {
            console.error(`Stage not found: ${currentStageId}`);
            return this.stages.get('greeting');
        }

        return currentStage;
    }

    /**
     * Determine next stage based on current stage and collected data
     * @param {Object} currentStage - Current stage definition
     * @param {Object} collectedData - Data collected so far
     * @param {string} userResponse - User's latest response
     * @returns {string} - Next stage ID
     */
    determineNextStage(currentStage, collectedData, userResponse) {
        const transitions = currentStage.transitions;

        // Check if all required data for current stage is collected
        const isDataComplete = this.isStageDataComplete(currentStage, collectedData);

        // Stage-specific logic
        switch (currentStage.id) {
            case 'greeting':
                // Check if user wants to proceed
                if (this.isNegativeResponse(userResponse)) {
                    return transitions.no;
                }
                return transitions.yes || transitions.default;

            case 'identify_patient':
                if (collectedData.patientRelation) {
                    return transitions.collected;
                }
                return currentStage.id; // Stay in same stage

            case 'medical_reason':
                if (collectedData.medicalReason) {
                    return transitions.collected;
                }
                return currentStage.id;

            case 'confirm_addmission_teleconsultation':
                // Decide path: admission flow vs teleconsultation flow
                if (userResponse.toLowerCase().includes('admission')||userResponse.toLowerCase().includes('admit')) {
                    collectedData.addmissionProcessInterest = 'yes';
                    return transitions.yes || currentStage.id;
                } else if (userResponse.toLowerCase().includes('consultation') || userResponse.toLowerCase().includes('doctor')) {
                    collectedData.addmissionProcessInterest = 'no';
                    return transitions.no || currentStage.id;
                }
                return currentStage.id;

            case 'show_hospitals':
                // If hospital is selected, skip await_hospital_selection and go to confirm_admission
                if (collectedData.selectedHospital) {
                    return transitions.selected || transitions.shown;
                }
                return transitions.shown; // Move to await_hospital_selection

            case 'await_hospital_selection':
                if (collectedData.selectedHospital) {
                    return transitions.collected;
                }
                return currentStage.id;

            case 'confirm_admission':
                if (collectedData.admissionConfirmed === true) {
                    return transitions.yes;
                } else if (collectedData.admissionConfirmed === false) {
                    return transitions.no;
                }
                return currentStage.id;

            case 'collect_admission_details':
                const hasCost = !!collectedData.estimatedCost;
                const hasDate = !!collectedData.admissionDate;

                if (hasCost && hasDate) {
                    return transitions.complete;
                } else if (hasCost || hasDate) {
                    return transitions.partial; // Partial data, stay in stage
                }
                return currentStage.id;

            case 'collect_preferences':
                if (collectedData.preferences || this.isSkipResponse(userResponse)) {
                    return transitions.collected || transitions.skipped;
                }
                return currentStage.id;

            case 'initiate_claim':
                if (collectedData.intimationId) {
                    return transitions.success;
                } else if (collectedData.claimError) {
                    return transitions.failure;
                }
                return currentStage.id;

            case 'schedule_followups':
                return transitions.complete; // Always complete

            case 'teleconsultation_response':
                if (collectedData.teleconsultationInterest === 'yes') {
                    return transitions.yes;
                } else if (collectedData.teleconsultationInterest === 'no') {
                    return transitions.no;
                }
                // If not set in collectedData, check user response directly (case-insensitive)
                const userResponseLower = (userResponse || '').toLowerCase();
                if (this.isPositiveResponse(userResponseLower)) {
                    collectedData.teleconsultationInterest = 'yes';
                    return transitions.yes;
                } else if (this.isNegativeResponse(userResponseLower)) {
                    collectedData.teleconsultationInterest = 'no';
                    return transitions.no;
                }
                return currentStage.id;

            case 'collect_consultation_preferences':
                const hasConsultationDate = !!collectedData.consultationDate;
                const hasConsultationTime = !!collectedData.consultationTime;

                if (hasConsultationDate && hasConsultationTime) {
                    return transitions.collected;
                }
                return currentStage.id;

            case 'confirm_consultation':
                return transitions.complete; // Always complete

            case 'admission_confirmed':
            case 'close_politely':
                if (userResponse.toLowerCase().includes('admission')) {
                    return transitions.initialIntent;
                } else {
                    return 'end';
                }

            default:
                return currentStage.id;
        }
    }

    /**
     * Check if all required data for a stage is collected
     * @param {Object} stage - Stage definition
     * @param {Object} collectedData - Data collected so far
     * @returns {boolean}
     */
    isStageDataComplete(stage, collectedData) {
        return stage.requiredData.every(key => collectedData[key] !== undefined && collectedData[key] !== null);
    }

    /**
     * Check if stage can proceed (has required data from previous stages)
     * @param {Object} stage - Stage definition
     * @param {Object} collectedData - Data collected so far
     * @returns {boolean}
     */
    canProceedToStage(stage, collectedData) {
        return this.isStageDataComplete(stage, collectedData);
    }

    /**
     * Extract data from user message based on current stage
     * @param {Object} stage - Current stage
     * @param {string} userMessage - User's message
     * @param {Object} existingData - Existing collected data
     * @returns {Object} - Extracted data
     */
    extractDataFromMessage(stage, userMessage, existingData) {
        const extracted = {};
        const messageLower = userMessage.toLowerCase();

        // Extract based on what this stage collects
        stage.collectData.forEach(dataKey => {
            switch (dataKey) {
                case 'initialIntent':
                    extracted.initialIntent = true; // User started conversation
                    break;

                case 'patientRelation':
                    if (messageLower.includes('my wife') || messageLower.includes('wife')) {
                        extracted.patientRelation = 'Spouse';
                    } else if (messageLower.includes('my son') || messageLower.includes('son')) {
                        extracted.patientRelation = 'Son';
                    } else if (messageLower.includes('my daughter') || messageLower.includes('daughter')) {
                        extracted.patientRelation = 'Daughter';
                    } else if (messageLower.includes('myself') || messageLower.includes('self') || messageLower.includes('me')) {
                        extracted.patientRelation = 'Self';
                    }
                    break;

                case 'medicalReason':
                    if (userMessage && !existingData.medicalReason) {
                        extracted.medicalReason = userMessage;
                    }
                    break;

                case 'location':
                    // Extract location if mentioned
                    const locationKeywords = ['in ', 'at ', 'near ', 'around '];
                    locationKeywords.forEach(keyword => {
                        if (messageLower.includes(keyword)) {
                            const parts = messageLower.split(keyword);
                            if (parts.length > 1) {
                                extracted.location = parts[1].split(' ')[0].trim();
                            }
                        }
                    });
                    break;

                case 'selectedHospital':
                    // Match against the shown hospitals using token-overlap scoring
                    if (existingData.hospitalSearchResults && existingData.hospitalSearchResults.length > 0) {
                        const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
                        const toTokens = (s) => normalize(s).split(' ').filter(w => w.length >= 3);
                        const msgTokens = new Set(toTokens(userMessage));

                        let best = { score: 0, hospital: null };
                        for (const h of existingData.hospitalSearchResults) {
                            const nameTokens = toTokens(h.hospitalName);
                            let score = 0;
                            for (const t of nameTokens) {
                                if (msgTokens.has(t)) score++;
                            }
                            // Boost exact/substring matches
                            const msgNorm = normalize(userMessage);
                            const nameNorm = normalize(h.hospitalName);
                            if (nameNorm === msgNorm) score += 3;
                            else if (nameNorm.includes(msgNorm) || msgNorm.includes(nameNorm)) score += 2;

                            if (score > best.score) best = { score, hospital: h };
                        }

                        if (best.hospital && best.score >= 2) {
                            console.log(`✅ Matched hospital: "${best.hospital.hospitalName}" from user input: "${userMessage}" (score=${best.score})`);
                            extracted.selectedHospital = best.hospital.hospitalName;
                            extracted.selectedHospitalDetails = best.hospital; // store full object for downstream accuracy
                        } else if (messageLower.includes('hospital')) {
                            // Fallback: if message contains "hospital", store raw
                            extracted.selectedHospital = userMessage;
                        }
                    } else if (messageLower.includes('hospital')) {
                        // No hospital list available, just extract if contains "hospital"
                        extracted.selectedHospital = userMessage;
                    }
                    break;

                case 'admissionConfirmed':
                    if (this.isPositiveResponse(messageLower)) {
                        extracted.admissionConfirmed = true;
                    } else if (this.isNegativeResponse(messageLower)) {
                        extracted.admissionConfirmed = false;
                    }
                    break;

                case 'estimatedCost':
                    const costMatch = userMessage.match(/\d{4,}/);
                    if (costMatch && !existingData.estimatedCost) {
                        extracted.estimatedCost = costMatch[0];
                    }
                    break;

                case 'admissionDate':
                case 'admissionTime':
                    if (!existingData.admissionDate) {
                        // Check for date patterns
                        const datePatterns = [
                            /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
                            /(\d{1,2})\s*(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
                            /(\d{1,2})[-\/](\d{1,2})/
                        ];

                        for (const pattern of datePatterns) {
                            const match = userMessage.match(pattern);
                            if (match) {
                                extracted.admissionDate = match[0];
                                break;
                            }
                        }

                        // Check for time
                        const timeMatch = userMessage.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
                        if (timeMatch) {
                            extracted.admissionTime = timeMatch[0];
                        }
                    }
                    break;

                case 'preferences':
                    if (userMessage && !existingData.preferences) {
                        extracted.preferences = userMessage;
                    }
                    break;

                case 'teleconsultationInterest':
                    if (this.isPositiveResponse(messageLower)) {
                        extracted.teleconsultationInterest = 'yes';
                    } else if (this.isNegativeResponse(messageLower)) {
                        extracted.teleconsultationInterest = 'no';
                    }
                    break;

                case 'addmissionProcessInterest':
                    if (this.isPositiveResponse(messageLower)) {
                        extracted.addmissionProcessInterest = 'yes';
                    } else if (this.isNegativeResponse(messageLower)) {
                        extracted.addmissionProcessInterest = 'no';
                    }
                    break;

                case 'consultationDate':
                    // Extract date for consultation
                    const consultDatePatterns = [
                        /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
                        /(\d{1,2})\s*(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
                        /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
                        /(today|tomorrow)/i
                    ];
                    for (const pattern of consultDatePatterns) {
                        const match = userMessage.match(pattern);
                        if (match) {
                            extracted.consultationDate = match[0];
                            break;
                        }
                    }
                    break;

                case 'consultationTime':
                    // Extract time for consultation
                    const consultTimePattern = /(\d{1,2})\s*(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i;
                    const consultTimeMatch = userMessage.match(consultTimePattern);
                    if (consultTimeMatch) {
                        extracted.consultationTime = consultTimeMatch[0];
                    }
                    break;
            }
        });

        return extracted;
    }

    /**
     * Check if response is positive (yes, ok, sure, etc.)
     * @param {string} message - User message
     * @returns {boolean}
     */
    isPositiveResponse(message) {
        const positive = ['yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'fine', 'correct', 'right', 'confirm'];
        return positive.some(word => message.includes(word));
    }

    /**
     * Check if response is negative (no, nope, etc.)
     * @param {string} message - User message
     * @returns {boolean}
     */
    isNegativeResponse(message) {
        const negative = ['no', 'nope', 'nah', 'not', 'never'];
        return negative.some(word => message.includes(word));
    }

    /**
     * Check if user wants to skip
     * @param {string} message - User message
     * @returns {boolean}
     */
    isSkipResponse(message) {
        const skip = ['skip', 'no preference', 'nothing', 'no requirements', 'none'];
        return skip.some(word => message.toLowerCase().includes(word));
    }

    /**
     * Get prompt template for current stage
     * @param {Object} stage - Current stage
     * @param {Object} collectedData - Data collected so far
     * @returns {string} - Prompt template
     */
    getStagePrompt(stage, collectedData, isFirstMessage = false) {
        const systemPrompts = this.getSystemPrompts();

        // Start with system prompts
        let prompt = `${systemPrompts}\n\n`;

        // Check if this is the first message

        if (isFirstMessage) {
            prompt += `**FIRST MESSAGE:** This is the first message in the conversation. You MUST start with a warm greeting using the customer's first name and 👋 emoji. Example: "Hi Vineet👋\\n\\nI see you're looking for hospitals. I hope everything is okay.\\n\\nAre you looking for admission for yourself or a family member?"\n\n`;
            prompt += `**CRITICAL:** You MUST greet the customer first before asking any questions. Start with "Hi [FirstName]👋" and then proceed with the stage instructions.\n\n`;
        }

        // Add stage-specific prompt
        const stagePrompt = stage.promptTemplate || '';

        // Add context about what's missing
        if (stage.id === 'collect_admission_details') {
            const hasCost = !!collectedData.estimatedCost;
            const hasDate = !!collectedData.admissionDate;

            if (!hasCost && !hasDate) {
                prompt += 'Ask for both estimated cost AND date/time of admission.';
            } else if (hasCost && !hasDate) {
                prompt += `Customer provided cost (₹${collectedData.estimatedCost}). Now ask ONLY for date/time. DO NOT ask for cost again.`;
            } else if (!hasCost && hasDate) {
                prompt += `Customer provided date/time (${collectedData.admissionDate} ${collectedData.admissionTime || ''}). Now ask ONLY for estimated cost. DO NOT ask for date/time again.`;
            } else {
                prompt += stagePrompt;
            }
        } else {
            prompt += stagePrompt;
        }

        return prompt;
    }
}

module.exports = ConversationOrchestrator;

