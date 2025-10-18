const CommunicationService = require('./communicationService');

/**
 * Scheduling Agent Service
 * Manages scheduled messages and automated follow-ups for customer journeys
 */
class SchedulingAgent {
  constructor(geminiService = null, intentJourneyService = null) {
    this.communicationService = new CommunicationService();
    this.geminiService = geminiService;
    this.intentJourneyService = intentJourneyService;
    this.scheduledMessages = new Map(); // conversationId -> array of scheduled messages
    this.executedMessages = new Map(); // conversationId -> array of executed messages
    this.defaultDelay = 10000; // 10 seconds default delay between messages
  }

  /**
   * Schedule a series of follow-up messages
   * @param {string} conversationId - Conversation ID
   * @param {string} customerId - Customer ID
   * @param {Array} messages - Array of message objects {text, delayInSeconds}
   * @returns {Object} - Scheduling result
   */
  scheduleMessages(conversationId, customerId, messages) {
    try {
      console.log(`Scheduling ${messages.length} messages for conversation ${conversationId}`);

      const scheduled = [];
      let cumulativeDelay = 0;

      messages.forEach((message, index) => {
        const delay = message.delayInSeconds ? message.delayInSeconds * 1000 : this.defaultDelay;
        cumulativeDelay += delay;

        const scheduledTime = new Date(Date.now() + cumulativeDelay);
        
        const messageJob = {
          id: `${conversationId}_${index}_${Date.now()}`,
          conversationId,
          customerId,
          text: message.text,
          scheduledTime: scheduledTime.toISOString(),
          delayMs: cumulativeDelay,
          status: 'scheduled',
          createdAt: new Date().toISOString()
        };

        // Schedule the message to be sent
        const timeoutId = setTimeout(() => {
          this.sendScheduledMessage(messageJob);
        }, cumulativeDelay);

        messageJob.timeoutId = timeoutId;
        scheduled.push(messageJob);
      });

      // Store scheduled messages
      const existing = this.scheduledMessages.get(conversationId) || [];
      this.scheduledMessages.set(conversationId, [...existing, ...scheduled]);

      return {
        success: true,
        conversationId,
        scheduledCount: scheduled.length,
        scheduledMessages: scheduled.map(m => ({
          id: m.id,
          text: m.text,
          scheduledTime: m.scheduledTime,
          status: m.status
        }))
      };

    } catch (error) {
      console.error('Error scheduling messages:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send a scheduled message
   * @param {Object} messageJob - Message job to execute
   */
  async sendScheduledMessage(messageJob) {
    try {
      console.log(`Executing scheduled message ${messageJob.id}`);
      console.log(`Scripted message: ${messageJob.text}`);

      let finalMessageText = messageJob.text;

      // If Gemini service is available, generate a better version of the message
      if (this.geminiService && this.intentJourneyService) {
        console.log('Generating humanized message via Gemini...');
        
        try {
          // Get conversation history
          const conversationHistory = this.intentJourneyService.getConversationHistory(messageJob.customerId);
          
          // Get policy info
          const policyInfo = this.intentJourneyService.policyInfo;
          
          // Build prompt for Gemini to humanize the scripted message
          const generatedMessage = await this.generateHumanizedMessage(
            messageJob.text,
            conversationHistory,
            policyInfo,
            messageJob.customerId
          );
          
          finalMessageText = generatedMessage;
          console.log(`Generated humanized message: ${finalMessageText}`);
          
        } catch (geminiError) {
          console.error('Error generating message via Gemini, using scripted version:', geminiError);
          // Fall back to scripted message
        }
      }

      // Convert escaped newlines to actual newlines for WhatsApp
      const whatsappMessage = finalMessageText.replace(/\\n/g, '\n');
      
      // Send message via WhatsApp
      const sendResult = await this.communicationService.sendMessage(whatsappMessage);

      // Update message status
      messageJob.status = sendResult.success ? 'sent' : 'failed';
      messageJob.sentAt = new Date().toISOString();
      messageJob.sendResult = sendResult;
      messageJob.finalText = finalMessageText;

      // Move to executed messages
      const executed = this.executedMessages.get(messageJob.conversationId) || [];
      executed.push(messageJob);
      this.executedMessages.set(messageJob.conversationId, executed);

      console.log(`Scheduled message ${messageJob.id} status: ${messageJob.status}`);

    } catch (error) {
      console.error(`Error sending scheduled message ${messageJob.id}:`, error);
      messageJob.status = 'error';
      messageJob.error = error.message;
    }
  }

  /**
   * Generate humanized message via Gemini
   * @param {string} scriptedMessage - The scripted message template
   * @param {Array} conversationHistory - Conversation history
   * @param {Object} policyInfo - Policy information
   * @param {string} customerId - Customer ID
   * @returns {Promise<string>} - Humanized message
   */
  async generateHumanizedMessage(scriptedMessage, conversationHistory, policyInfo, customerId) {
    const firstName = policyInfo ? policyInfo.policyholder.split(' ')[0] : 'there';

    // Build context from conversation history
    let conversationContext = '';
    if (conversationHistory && conversationHistory.length > 0) {
      conversationContext = '**Recent Conversation:**\n';
      // Get last 5 messages
      const recentHistory = conversationHistory.slice(-5);
      recentHistory.forEach(msg => {
        if (msg.incommingMessage) {
          conversationContext += `Customer: ${msg.incommingMessage}\n`;
        } else if (msg.sentMessage) {
          conversationContext += `You: ${msg.sentMessage}\n`;
        }
      });
      conversationContext += '\n';
    }

    const prompt = `You are a Claim Concierge for Tata AIG insurance, sending a proactive follow-up message to ${firstName}.

${conversationContext}

**Your Task:**
Transform the scripted message below into a natural, humanized, warm message while keeping the core information intact.

**Scripted Message (use as guidance):**
${scriptedMessage}

**Guidelines:**
- Write in a NATURAL, HUMANIZED way - like a caring professional
- Use minimal emojis (max 1-2) and only where meaningful
- Use WhatsApp formatting: *bold* for important info, \\n for line breaks
- Keep it conversational but professional
- Make it personal using the customer's first name: ${firstName}
- Reference conversation context if relevant
- Keep the key information from the scripted message
- Make sure the message flows naturally

**Your Response (WhatsApp message only, no explanations):**`;

    const result = await this.geminiService.model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.8,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 1024
      }
    });

    const generatedMessage = result.response.text().trim();
    return generatedMessage;
  }

  /**
   * Schedule follow-up messages based on intent action
   * @param {string} conversationId - Conversation ID
   * @param {string} customerId - Customer ID
   * @param {string} action - Action type (e.g., 'hospital_admission_scheduled')
   * @param {Object} context - Context data (date, time, hospital name, etc.)
   */
  scheduleIntentBasedFollowUps(conversationId, customerId, action, context = {}) {
    const followUpMessages = this.getFollowUpMessagesForAction(action, context);
    
    if (followUpMessages.length > 0) {
      return this.scheduleMessages(conversationId, customerId, followUpMessages);
    }

    return { success: false, message: 'No follow-up messages for this action' };
  }

  /**
   * Get follow-up messages for specific actions
   * @param {string} action - Action type
   * @param {Object} context - Context data
   * @returns {Array} - Array of follow-up messages
   */
  getFollowUpMessagesForAction(action, context) {
    const followUpTemplates = {
      'hospital_admission_scheduled': [
        {
          text: `Hi ${context.customerName || 'there'},\n\nYour admission at *${context.hospitalName || 'the hospital'}* has been confirmed for *${context.date || 'the scheduled date'}*.\n\nI've informed the hospital about your preferences. You should receive a confirmation call from them shortly.`,
          delayInSeconds: 10
        },
        {
          text: `Quick reminder - Please bring these documents for your admission:\n\n*Required Documents:*\n- Aadhaar card\n- Insurance card\n- ID proof\n- Medical records (if any)\n- Prescription from your doctor\n\nLet me know if you need any assistance!`,
          delayInSeconds: 10
        }
      ],
      'hospital_recommendations_sent': [
        {
          text: `Just checking in - did you get a chance to review the hospital options I sent?\n\nIf you need more details about any specific hospital or want me to schedule an appointment, just let me know!`,
          delayInSeconds: 10
        }
      ],
      'appointment_confirmation_needed': [
        {
          text: `Hi there!\n\nI wanted to follow up on your appointment scheduling. Have you decided which hospital works best for you?\n\nI'm here to help coordinate everything once you're ready.`,
          delayInSeconds: 10
        }
      ]
    };

    const messages = followUpTemplates[action] || [];
    
    // Replace placeholders in messages
    return messages.map(msg => ({
      ...msg,
      text: this.replacePlaceholders(msg.text, context)
    }));
  }

  /**
   * Replace placeholders in message text
   * @param {string} text - Message text with placeholders
   * @param {Object} context - Context data
   * @returns {string} - Text with placeholders replaced
   */
  replacePlaceholders(text, context) {
    let result = text;
    Object.keys(context).forEach(key => {
      const placeholder = `{{${key}}}`;
      if (result.includes(placeholder)) {
        result = result.replace(new RegExp(placeholder, 'g'), context[key]);
      }
    });
    return result;
  }

  /**
   * Cancel scheduled messages for a conversation
   * @param {string} conversationId - Conversation ID
   * @returns {boolean} - Success status
   */
  cancelScheduledMessages(conversationId) {
    const scheduled = this.scheduledMessages.get(conversationId);
    
    if (scheduled) {
      scheduled.forEach(message => {
        if (message.timeoutId && message.status === 'scheduled') {
          clearTimeout(message.timeoutId);
          message.status = 'cancelled';
        }
      });
      
      console.log(`Cancelled ${scheduled.length} scheduled messages for conversation ${conversationId}`);
      return true;
    }
    
    return false;
  }

  /**
   * Get scheduled messages for a conversation
   * @param {string} conversationId - Conversation ID
   * @returns {Array} - Array of scheduled messages
   */
  getScheduledMessages(conversationId) {
    return this.scheduledMessages.get(conversationId) || [];
  }

  /**
   * Get executed messages for a conversation
   * @param {string} conversationId - Conversation ID
   * @returns {Array} - Array of executed messages
   */
  getExecutedMessages(conversationId) {
    return this.executedMessages.get(conversationId) || [];
  }

  /**
   * Get all messages (scheduled and executed) for a conversation
   * @param {string} conversationId - Conversation ID
   * @returns {Object} - Object with scheduled and executed messages
   */
  getAllMessages(conversationId) {
    return {
      scheduled: this.getScheduledMessages(conversationId),
      executed: this.getExecutedMessages(conversationId)
    };
  }
}

module.exports = SchedulingAgent;

