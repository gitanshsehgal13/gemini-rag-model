const express = require('express');
const router = express.Router();
const axios = require('axios');
// Import constants
const CONFIG = require('../../config/constants');

/**
 * Remove special characters from text for voice-friendly output
 * @param {string} text - Input text
 * @returns {string} - Cleaned text without special characters
 */
function removeSpecialCharacters(text) {
  if (!text) return text;
  // Remove special characters: * \ % $ # & ^ @
  return text.replace(/[\*\\%\$#&\^@]/g, '');
}

/**
 * Convert Hindi text to Hinglish using Gemini AI
 * @param {string} hindiText - Hindi text in Devanagari script
 * @param {Object} geminiService - GeminiService instance
 * @returns {Promise<string>} - Hinglish transliteration
 */
async function toHinglish(hindiText, geminiService) {
  try {
    if (!geminiService) {
      console.error('GeminiService not available for Hindi to Hinglish conversion');
      return hindiText; // fallback
    }

    const prompt = `Convert the following Hindi text (written in Devanagari script) to Hinglish (Hindi written in Roman/Latin script). 
Only return the Hinglish transliteration, nothing else. Do not add any explanations or additional text.

Hindi text: "${hindiText}"

Hinglish transliteration:`;

    const result = await geminiService.generateContentWithRetry({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        topK: 1,
        topP: 0.8,
        maxOutputTokens: 256
      }
    });
    console.log("result from Hindi to Hinglish:", result);
    const hinglishText = result.response.text().trim();
    console.log(`Converted Hindi to Hinglish: "${hindiText}" -> "${hinglishText}"`);
    
    return hinglishText;
  } catch (error) {
    console.error('Error converting Hindi to Hinglish using Gemini:', error);
    return hindiText; // fallback on error
  }
}

/**
 * Check if text contains Hindi (Devanagari script)
 * @param {string} text - Input text
 * @returns {boolean} - True if text contains Hindi characters
 */
function isHindi(text) {
  // If text contains *any non-Latin* character, treat as Hindi
  return /[^\u0000-\u00FF]/.test(text);
}

/**
 * Normalize user message by converting Hindi to Hinglish
 * @param {string} text - User input text
 * @param {Object} geminiService - GeminiService instance
 * @returns {Promise<string>} - Normalized text (Hinglish/English)
 */
async function normalizeUserMessage(text, geminiService) {
  if (!text) return text;
  
  if (isHindi(text)) {
    console.log("Detected Hindi text, converting to Hinglish...");
    return await toHinglish(text, geminiService);
  }
  return text; // Already Hinglish/English
}

/**
 * Dialogflow Webhook Endpoint
 * Handles incoming requests from Dialogflow and integrates with existing RAG system
 * Always uses customer ID from constants
 */
router.post('/dialogflow', async (req, res) => {
  try {
    console.log('Received Dialogflow webhook request:', JSON.stringify(req.body, null, 2));

    const { queryResult, session, queryParams } = req.body;

    // Extract input contexts for context continuity
    const inputContexts = req.body.queryResult?.outputContexts || [];
    console.log('Input contexts:', JSON.stringify(inputContexts, null, 2));

    if (!queryResult || !queryResult.queryText) {
      const errorMsg = removeSpecialCharacters("I didn't understand your request. Please try again.");
      return res.status(400).json({
        fulfillmentText: errorMsg,
        fulfillmentMessages: [{
          text: {
            text: [errorMsg]
          }
        }]
      });
    }

    // Extract query text from Dialogflow request
    let queryText = queryResult.queryText;

    // Use customer ID from constants
    const customerId = CONFIG.DEFAULT_CUSTOMER_ID;

    // Get customer service instance from app
    const customerService = req.app.get('customerService');

    // Normalize user message: Convert Hindi to Hinglish using Gemini
    if (customerService && customerService.geminiService) {
      queryText = await normalizeUserMessage(queryText, customerService.geminiService);
      console.log(`Normalized query text: ${queryText}`);
    } else {
      console.log('GeminiService not available, skipping Hindi to Hinglish conversion');
    }

    console.log(`Processing Dialogflow query for customer ${customerId}: ${queryText}`);
    // const healthCheckupService = req.app.get('healthCheckupService');

    if (!customerService) {
      console.error('Customer service not available');
      const errorMsg = removeSpecialCharacters("Sorry, the service is temporarily unavailable. Please try again later.");
      return res.status(500).json({
        fulfillmentText: errorMsg,
        fulfillmentMessages: [{
          text: {
            text: [errorMsg]
          }
        }]
      });
    }

    // Extract context parameters for enhanced query processing
    let contextParams = {};
    let conversationHistory = [];

    // Get context from input contexts
    inputContexts.forEach(context => {
      if (context.parameters) {
        contextParams = { ...contextParams, ...context.parameters };
      }
    });

    // Build conversation history from context
    if (contextParams.lastQuery) {
      conversationHistory.push({
        query: contextParams.lastQuery,
        answer: contextParams.lastAnswer,
        timestamp: contextParams.lastQueryTime || new Date().toISOString()
      });
    }

    console.log('Context parameters:', contextParams);
    console.log('Conversation history:', conversationHistory);

    // Use existing queryDocuments functionality with context
    const queryOptions = {
      context: contextParams,
      conversationHistory: conversationHistory
    };
    console.log("🏥 Routing to Health Checkup Journey Service");
    
    // Get health checkup service from customer service
    const healthCheckupService = customerService.intentJourneyService?.healthCheckupService;
    if (!healthCheckupService) {
      throw new Error('Health checkup service not available');
    }
    
    const result = await healthCheckupService.processHealthCheckupQuery(
      customerId,
      queryText,
    );
    // const result = await customerService.queryDocuments(customerId, queryText, queryOptions);

    console.log(`Dialogflow query result for ${customerId}:`, {
      confidence: result.confidence,
      queryType: result.queryType,
      sourceChunks: result.sourceChunks?.length || 0
    });

    // Format response for Dialogflow
    const rawAnswerText = result.answer || "I couldn't find specific information about your query. Please contact customer service for more detailed assistance.";

    // Remove special characters for voice-friendly output
    const answerText = removeSpecialCharacters(rawAnswerText);

    // Enhanced context management for follow-up queries
    const outputContexts = [
      {
        name: `${session}/contexts/customer-session`,
        lifespanCount: 20, // Increased lifespan for better context retention
        parameters: {
          customerId: customerId,
          lastQueryType: result.queryType,
          confidence: result.confidence,
          lastQuery: queryText,
          lastAnswer: answerText,
          lastQueryTime: new Date().toISOString(),
          // Preserve existing context parameters
          ...contextParams,
          // Add conversation turn counter
          conversationTurn: (contextParams.conversationTurn || 0) + 1
        }
      },
      {
        name: `${session}/contexts/conversation-history`,
        lifespanCount: 15,
        parameters: {
          customerId: customerId,
          conversationHistory: JSON.stringify([
            ...conversationHistory,
            {
              query: queryText,
              answer: answerText,
              timestamp: new Date().toISOString(),
              queryType: result.queryType,
              confidence: result.confidence
            }
          ])
        }
      }
    ];

    const dialogflowResponse = {
      fulfillmentText: answerText,
      fulfillmentMessages: [{
        text: {
          text: [answerText]
        }
      }],
      outputContexts: outputContexts
    };

    console.log('Sending Dialogflow response:', JSON.stringify(dialogflowResponse, null, 2));

    res.json(dialogflowResponse);

  } catch (error) {
    console.error('Error processing Dialogflow webhook:', error);
    console.error('Error stack:', error.stack);

    const rawErrorText = `Sorry, I encountered an error while processing your request: ${error.message}. Please try again.`;
    const errorText = removeSpecialCharacters(rawErrorText);

    res.status(500).json({
      fulfillmentText: errorText,
      fulfillmentMessages: [{
        text: {
          text: [errorText]
        }
      }]
    });
  }
});

/**
 * Health check endpoint for webhook
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'dialogflow-webhook',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
