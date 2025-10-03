const DocumentProcessor = require('./documentProcessor');
const EmbeddingService = require('./embeddingService');
const VectorStore = require('./vectorStore');
const GeminiService = require('./geminiService');
const ClaimDocumentService = require('./claimDocumentService');
const HospitalService = require('./hospitalService');
const PolicyTimelineService = require('./policyTimelineService');
const path = require('path');

class CustomerService {
  constructor(config) {
    this.config = config;
    this.documentProcessor = new DocumentProcessor();
    this.embeddingService = new EmbeddingService(config.googleAiApiKey, config.embeddingConfig);
    this.vectorStore = new VectorStore(config.storageDir);
    this.geminiService = new GeminiService(config.googleAiApiKey);
    this.claimDocumentService = new ClaimDocumentService();
    
    // Initialize hospital service
    this.hospitalService = new HospitalService();
    
    // Initialize policy timeline service
    this.policyTimelineService = new PolicyTimelineService();
    
    // Conversation history storage (in-memory for now)
    this.conversationHistory = new Map(); // customerId -> conversation array
  }

  /**
   * Initialize the customer service
   */
  async initialize() {
    await this.vectorStore.initializeStorage();
    console.log('Customer service initialized');
  }

  /**
   * Add a message to conversation history
   * @param {string} customerId - Customer ID
   * @param {string} role - 'user' or 'assistant'
   * @param {string} content - Message content
   */
  addToConversationHistory(customerId, role, content) {
    if (!this.conversationHistory.has(customerId)) {
      this.conversationHistory.set(customerId, []);
    }
    
    const conversation = this.conversationHistory.get(customerId);
    conversation.push({
      role,
      content,
      timestamp: new Date().toISOString()
    });
    
    // Keep only last 10 messages to prevent memory bloat
    if (conversation.length > 10) {
      conversation.splice(0, conversation.length - 10);
    }
  }

  /**
   * Get conversation history for a customer
   * @param {string} customerId - Customer ID
   * @param {number} lastN - Number of recent messages to get (default: 5)
   * @returns {Array} - Conversation history
   */
  getConversationHistory(customerId, lastN = 5) {
    const conversation = this.conversationHistory.get(customerId) || [];
    return conversation.slice(-lastN);
  }

  /**
   * Clear conversation history for a customer
   * @param {string} customerId - Customer ID
   */
  clearConversationHistory(customerId) {
    this.conversationHistory.delete(customerId);
  }

  /**
   * Add a new customer
   * @param {string} customerId - Customer ID
   * @param {Object} customerData - Customer information
   * @returns {Promise<Object>} - Customer data
   */
  async addCustomer(customerId, customerData) {
    return await this.vectorStore.addCustomer(customerId, customerData);
  }

  /**
   * Get customer information
   * @param {string} customerId - Customer ID
   * @returns {Object|null} - Customer data
   */
  getCustomer(customerId) {
    return this.vectorStore.getCustomer(customerId);
  }

  /**
   * Process and store a policy document for a customer
   * @param {string} customerId - Customer ID
   * @param {string} filePath - Path to the document file
   * @param {string} originalName - Original filename
   * @returns {Promise<Object>} - Processing result
   */
  async processDocument(customerId, filePath, originalName) {
    try {
      console.log(`Processing document ${originalName} for customer ${customerId}`);

      // Determine file type
      const fileExtension = path.extname(originalName).toLowerCase().substring(1);
      
      // Process document and extract content (text and/or images)
      const content = await this.documentProcessor.processDocument(filePath, fileExtension);
      
      // Validate content
      const validation = this.documentProcessor.validateMultimodalContent(content);
      if (!validation.isValid) {
        throw new Error(`Invalid content: ${validation.errors.join(', ')}`);
      }
      
      // Log warnings if any
      if (validation.warnings.length > 0) {
        console.warn('Content warnings:', validation.warnings);
      }
      
      // Extract metadata (handles both text-only and multimodal content)
      const metadata = content.images && content.images.length > 0
        ? this.documentProcessor.extractMultimodalMetadata(content, originalName)
        : this.documentProcessor.extractMetadata(content.text || '', originalName);
      
      // Store document in vector store (store content as JSON for multimodal support)
      const documentContent = typeof content === 'string' ? content : JSON.stringify(content);
      const documentId = await this.vectorStore.addDocument(customerId, originalName, documentContent, metadata);
      
      // Create chunks (supports both text-only and multimodal content)
      const chunks = this.documentProcessor.chunkContent(content, documentId, customerId);
      console.log(`Created ${chunks.length} chunks for document ${documentId}`);
      
      // Generate embeddings for chunks
      const embeddingResults = [];
      
      for (const chunk of chunks) {
        let embeddingResult;
        
        if (chunk.type === 'multimodal' || chunk.type === 'image-only') {
          // Use multimodal embedding for chunks with images
          const multimodalContent = {
            text: chunk.text || '',
            images: chunk.images || []
          };
          
          embeddingResult = await this.embeddingService.generateMultimodalEmbedding(multimodalContent);
        } else {
          // Use text embedding for text-only chunks
          embeddingResult = await this.embeddingService.generateTextEmbedding(chunk.text);
        }
        
        embeddingResults.push(embeddingResult);
      }
      
      // Add embeddings to chunks
      const chunksWithEmbeddings = chunks.map((chunk, index) => ({
        ...chunk,
        embedding: embeddingResults[index].values,
        embeddingModel: embeddingResults[index].model,
        embeddingDimensions: embeddingResults[index].dimensions,
        embeddingTaskType: embeddingResults[index].taskType,
        multimodalDescription: embeddingResults[index].multimodalDescription || null
      }));
      
      // Store chunks in vector store
      await this.vectorStore.addChunks(chunksWithEmbeddings);
      
      console.log(`Successfully processed document ${documentId} with ${chunks.length} chunks`);
      
      return {
        documentId,
        filename: originalName,
        customerId,
        chunkCount: chunks.length,
        metadata,
        contentType: metadata.contentType || 'text',
        hasImages: metadata.hasImages || false,
        imageCount: metadata.imageCount || 0,
        processedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error processing document:', error);
      throw error;
    }
  }

  /**
   * Process multimodal document with text and images
   * @param {string} customerId - Customer ID
   * @param {Object} documentFile - Primary document file (optional)
   * @param {Array<Object>} imageFiles - Array of image files
   * @param {string} description - Description of the multimodal content
   * @returns {Promise<Object>} - Processing result
   */
  async processMultimodalDocument(customerId, documentFile, imageFiles = [], description = '') {
    try {
      console.log(`Processing multimodal document for customer ${customerId}`);
      console.log(`Primary document: ${documentFile ? documentFile.originalname : 'None'}`);
      console.log(`Image files: ${imageFiles.length}`);

      let multimodalContent = {
        text: description,
        images: []
      };

      // Process primary document if provided
      if (documentFile) {
        const fileExtension = path.extname(documentFile.originalname).toLowerCase().substring(1);
        const documentContent = await this.documentProcessor.processDocument(documentFile.path, fileExtension);
        
        if (documentContent.text) {
          multimodalContent.text = documentContent.text + (description ? `\n\nAdditional context: ${description}` : '');
        }
        
        if (documentContent.images) {
          multimodalContent.images.push(...documentContent.images);
        }
      }

      // Process additional image files
      for (const imageFile of imageFiles) {
        const fileExtension = path.extname(imageFile.originalname).toLowerCase().substring(1);
        const imageContent = await this.documentProcessor.processDocument(imageFile.path, fileExtension);
        
        if (imageContent.images) {
          multimodalContent.images.push(...imageContent.images);
        }
      }

      // Validate multimodal content
      const validation = this.documentProcessor.validateMultimodalContent(multimodalContent);
      if (!validation.isValid) {
        throw new Error(`Invalid multimodal content: ${validation.errors.join(', ')}`);
      }

      if (validation.warnings.length > 0) {
        console.warn('Multimodal content warnings:', validation.warnings);
      }

      // Generate filename for multimodal document
      const filename = documentFile 
        ? `${path.parse(documentFile.originalname).name}_with_${imageFiles.length}_images${path.extname(documentFile.originalname)}`
        : `multimodal_images_${imageFiles.length}_files.json`;

      // Extract metadata
      const metadata = this.documentProcessor.extractMultimodalMetadata(multimodalContent, filename);
      
      // Store document in vector store
      const documentContent = JSON.stringify(multimodalContent);
      const documentId = await this.vectorStore.addDocument(customerId, filename, documentContent, metadata);
      
      // Create chunks
      const chunks = this.documentProcessor.chunkContent(multimodalContent, documentId, customerId);
      console.log(`Created ${chunks.length} multimodal chunks for document ${documentId}`);
      
      // Generate embeddings for chunks
      const embeddingResults = [];
      
      for (const chunk of chunks) {
        let embeddingResult;
        
        if (chunk.type === 'multimodal' || chunk.type === 'image-only') {
          // Use multimodal embedding
          const chunkContent = {
            text: chunk.text || '',
            images: chunk.images || []
          };
          
          embeddingResult = await this.embeddingService.generateMultimodalEmbedding(chunkContent);
          
          console.log(`Generated multimodal embedding for chunk ${chunk.id} using ${embeddingResult.model}`);
        } else {
          // Use text embedding for text-only chunks
          embeddingResult = await this.embeddingService.generateTextEmbedding(chunk.text);
        }
        
        embeddingResults.push(embeddingResult);
      }
      
      // Add embeddings to chunks
      const chunksWithEmbeddings = chunks.map((chunk, index) => ({
        ...chunk,
        embedding: embeddingResults[index].values,
        embeddingModel: embeddingResults[index].model,
        embeddingDimensions: embeddingResults[index].dimensions,
        embeddingTaskType: embeddingResults[index].taskType,
        multimodalDescription: embeddingResults[index].multimodalDescription || null
      }));
      
      // Store chunks in vector store
      await this.vectorStore.addChunks(chunksWithEmbeddings);
      
      console.log(`Successfully processed multimodal document ${documentId} with ${chunks.length} chunks`);
      
      return {
        documentId,
        filename,
        customerId,
        chunkCount: chunks.length,
        metadata,
        contentType: 'multimodal',
        hasImages: true,
        imageCount: multimodalContent.images.length,
        textLength: multimodalContent.text ? multimodalContent.text.length : 0,
        processedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error processing multimodal document:', error);
      throw error;
    }
  }

  /**
   * Query customer's policy documents
   * @param {string} customerId - Customer ID
   * @param {string} query - Customer query
   * @param {Object} options - Query options
   * @returns {Promise<Object>} - Query response
   */
  async queryDocuments(customerId, query, options = {}) {
    try {
      console.log(`Processing query for customer ${customerId}: ${query}`);

      const {
        topK = 5,
        similarityThreshold = 0.5, // Lowered to 0.5 for better recall on general queries
        includeContext = true
      } = options;

      // Check if customer exists
      const customer = this.vectorStore.getCustomer(customerId);
      if (!customer) {
        throw new Error(`Customer ${customerId} not found`);
      }

      // Preprocess query to handle common typos and variations
      const processedQuery = this.preprocessQuery(query);

      // Check if query is policy-related or conversational
      const queryAnalysis = this.analyzeQuery(query);
      console.log(`Query analysis for "${query}":`, queryAnalysis);
      if (queryAnalysis.type === 'out_of_scope') {
        return {
          answer: queryAnalysis.response,
          confidence: 0,
          sourceChunks: [],
          queryType: 'out_of_scope'
        };
      } else if (queryAnalysis.type === 'reschedule_request') {
        // Handle reschedule requests
        // Add user message to conversation history
        this.addToConversationHistory(customerId, 'user', query);
        
        // Parse the reschedule request
        const parsedRequest = this.policyTimelineService.parseRescheduleRequest(query);
        
        if (!parsedRequest.date) {
          // Ask for specific date if not provided
          const clarificationResponse = "I can help you reschedule your health checkup! Could you please let me know the new date you'd prefer? For example, you can say 'reschedule to November 25' or 'change to next week'.";
          
          this.addToConversationHistory(customerId, 'assistant', clarificationResponse);
          
          return {
            answer: clarificationResponse,
            confidence: 1.0,
            sourceChunks: [],
            queryType: 'reschedule_clarification'
          };
        }
        
        // Attempt to reschedule
        const rescheduleResult = this.policyTimelineService.rescheduleHealthCheckup(
          parsedRequest.date,
          parsedRequest.time
        );
        
        let response;
        if (rescheduleResult.success) {
          response = `Perfect! I've successfully rescheduled your health checkup from ${rescheduleResult.originalDate} to ${rescheduleResult.newDate}. ${rescheduleResult.updatedEvent.details}`;
        } else {
          // Check if we have alternative slots to offer
          if (rescheduleResult.alternativeSlots && rescheduleResult.alternativeSlots.length > 0) {
            response = `${rescheduleResult.message}\n\nHowever, I found available slots on these dates:\n\n`;
            
            rescheduleResult.alternativeSlots.forEach(slot => {
              response += `📅 **${slot.date}**\n`;
              response += `⏰ Available time slots: ${slot.timeSlots.join(', ')}\n\n`;
            });
            
            response += `Would you like to book any of these alternative dates? Just let me know which date and time works for you!`;
          } else {
            response = `I'm sorry, but I couldn't reschedule your appointment. ${rescheduleResult.message} Please contact our customer service team for assistance.`;
          }
        }
        
        // Add assistant response to conversation history
        this.addToConversationHistory(customerId, 'assistant', response);
        
        return {
          answer: response,
          confidence: rescheduleResult.success ? 1.0 : 0.8,
          sourceChunks: [],
          queryType: 'reschedule_result',
          rescheduleDetails: rescheduleResult
        };
      } else if (queryAnalysis.type === 'conversational') {
        // Add user message to conversation history
        this.addToConversationHistory(customerId, 'user', query);
        
        // Get recent conversation history for context
        const conversationHistory = this.getConversationHistory(customerId, 3);
        
        // Generate natural conversational response using LLM with context
        const conversationalResponse = await this.geminiService.generateConversationalResponse(
          query, 
          customerId, 
          conversationHistory
        );
        
        // Add assistant response to conversation history
        this.addToConversationHistory(customerId, 'assistant', conversationalResponse);
        
        return {
          answer: conversationalResponse,
          confidence: 1.0,
          sourceChunks: [],
          queryType: 'conversational'
        };
      }

      // Add user message to conversation history for policy-related queries too
      this.addToConversationHistory(customerId, 'user', query);

      // Check if this is a health checkup booking details query FIRST
      const isHealthCheckupBookingQuery = /\b(get\s+my|show\s+me|my)\s+(health\s+checkup|checkup)\s+(booking\s+)?(details?|information|status|appointment)/i.test(query) ||
                                         /\b(health\s+checkup|checkup)\s+(booking\s+)?(details?|information|status|appointment)/i.test(query);
      
      if (isHealthCheckupBookingQuery) {
        // Check policy timeline for health checkup booking details
        const timelineData = this.policyTimelineService.loadTimelineData();
        const pendingCheckups = this.policyTimelineService.findPendingHealthCheckups(timelineData);
        
        if (pendingCheckups.length > 0) {
          const checkup = pendingCheckups[0]; // Get the first pending checkup
          const bookingDetails = `Here are your health checkup booking details:

**📅 Scheduled Date:** ${checkup.date}
**⏰ Time Slot:** Sample collection between 9 AM - 11 AM
**📋 Status:** ${checkup.status}
**💰 Benefit Value:** ${checkup.benefitValue}
**ℹ️ Details:** ${checkup.details}

Your health checkup is all set! The sample collection team will visit during the scheduled time slot. If you need to reschedule, just let me know and I can help you with that.`;

          const response = {
            answer: bookingDetails,
            confidence: 1.0,
            sourceChunks: [],
            queryType: 'health_checkup_booking',
            bookingInfo: {
              date: checkup.date,
              status: checkup.status,
              timeSlot: "9 AM - 11 AM",
              benefitValue: checkup.benefitValue
            }
          };

          // Add assistant response to conversation history
          this.addToConversationHistory(customerId, 'assistant', response.answer);
          return response;
        } else {
          // No pending checkups found, check if they've already completed one
          const completedCheckups = timelineData.events.filter(event => 
            event.title.toLowerCase().includes('health checkup') && event.status === 'Completed'
          );
          
          let message;
          if (completedCheckups.length > 0) {
            message = "I can see you've already completed your health checkup this policy year. Your next annual health checkup will be available after your policy renewal. Would you like me to help you with anything else regarding your health benefits?";
          } else {
            message = "I don't see any pending health checkup bookings for you right now. Would you like me to help you schedule a health checkup? It's included as part of your policy benefits.";
          }
          
          const response = {
            answer: message,
            confidence: 1.0,
            sourceChunks: [],
            queryType: 'health_checkup_booking'
          };

          // Add assistant response to conversation history
          this.addToConversationHistory(customerId, 'assistant', response.answer);
          return response;
        }
      }

      // Check if query is about hospitals FIRST (before policy document search)
      let hospitalRecommendations = null;
      const hospitalQuery = this.analyzeHospitalQuery(query);
      console.log(`Hospital query analysis for "${query}":`, hospitalQuery);
      if (hospitalQuery.isHospitalRelated) {
        hospitalRecommendations = this.getHospitalRecommendations(hospitalQuery);
        console.log(`Hospital recommendations:`, hospitalRecommendations);
        
        // For hospital queries, only use Gemini for complex queries, not simple lookups
        if (hospitalRecommendations && hospitalRecommendations.isAvailable) {
          this.addToConversationHistory(customerId, 'user', query);
          
          // For simple hospital listings, return formatted data without API call
          const isSimpleQuery = hospitalQuery.queryType === 'network' || 
                               hospitalQuery.queryType === 'nearby' || 
                               (hospitalQuery.queryType === 'search' && !query.toLowerCase().includes('tell me about'));
          
          if (isSimpleQuery && hospitalRecommendations.count <= 5) {
            console.log('Using direct hospital response (no API call)');
            const answer = `Here are the hospitals I found for you:\n\n${hospitalRecommendations.hospitalList}`;
            this.addToConversationHistory(customerId, 'assistant', answer);
            
            return {
              answer: answer,
              confidence: 1.0,
              sourceChunks: [],
              queryType: 'hospital_info',
              hospitalData: {
                queryType: hospitalQuery.queryType,
                searchTerm: hospitalQuery.searchTerm,
                count: hospitalRecommendations.count
              }
            };
          }
          
          // For complex queries or specific hospital details, use Gemini
          console.log('Using Gemini for complex hospital query');
          const conversationHistory = this.getConversationHistory(customerId, 3);
          
          // Generate personalized response using Gemini with hospital data
          const response = await this.geminiService.generateResponse(
            query, 
            [], // No policy chunks needed for hospital queries
            customerId,
            conversationHistory,
            null, // No claim documents
            hospitalRecommendations // Pass hospital data to Gemini
          );
          
          this.addToConversationHistory(customerId, 'assistant', response.answer);
          
          return {
            answer: response.answer,
            confidence: 1.0,
            sourceChunks: [],
            queryType: 'hospital_info',
            hospitalData: {
              queryType: hospitalQuery.queryType,
              searchTerm: hospitalQuery.searchTerm,
              count: hospitalRecommendations.count
            }
          };
        }
      }

      // Enhance query with conversation context for better similarity search
      const enhancedQuery = this.enhanceQueryWithContext(processedQuery, customerId);
      
      // Generate query embedding using the enhanced query
      const queryEmbeddingResult = await this.embeddingService.generateEmbedding(enhancedQuery);
      
      // Search for similar chunks
      const relevantChunks = this.vectorStore.searchSimilarChunks(
        customerId, 
        queryEmbeddingResult.values, 
        topK, 
        similarityThreshold
      );

      if (relevantChunks.length === 0) {
        return {
          answer: "I couldn't find specific information about your query in your policy documents. Please contact customer service for more detailed assistance or try rephrasing your question.",
          confidence: 0,
          sourceChunks: [],
          queryType: 'no_match'
        };
      }

      // Get conversation history for context-aware responses
      const conversationHistory = this.getConversationHistory(customerId, 3);
      
      // Check if query is about document requirements or upload
      let claimDocuments = null;
      const isDocumentQuery = /\b(document|documents|papers|forms|requirement|requirements|need|submit|reimbursement|claim|upload)\b/i.test(query);
      if (isDocumentQuery) {
        claimDocuments = this.getClaimDocumentRequirements('reimbursement');
      }
      
      // Generate response using Gemini with conversation context, claim documents, and hospital data
      const response = await this.geminiService.generateResponse(
        query, 
        relevantChunks, 
        customerId,
        conversationHistory,
        claimDocuments,
        hospitalRecommendations
      );

      console.log(`Generated response for customer ${customerId} with confidence ${response.confidence}`);
      console.log(`Used embedding model: ${queryEmbeddingResult.model} for query processing`);

      // Add assistant response to conversation history
      this.addToConversationHistory(customerId, 'assistant', response.answer);

      return {
        ...response,
        queryType: 'success',
        customerId,
        query,
        embeddingModel: queryEmbeddingResult.model,
        embeddingDimensions: queryEmbeddingResult.dimensions,
        processedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error querying documents:', error);
      throw error;
    }
  }

  /**
   * Get policy summary for a customer
   * @param {string} customerId - Customer ID
   * @returns {Promise<Object>} - Policy summary
   */
  async getPolicySummary(customerId) {
    try {
      const customer = this.vectorStore.getCustomer(customerId);
      if (!customer) {
        throw new Error(`Customer ${customerId} not found`);
      }

      const documents = this.vectorStore.getCustomerDocuments(customerId);
      if (documents.length === 0) {
        return {
          summary: "No policy documents found for this customer.",
          documentCount: 0,
          generatedAt: new Date().toISOString()
        };
      }

      const summary = await this.geminiService.generatePolicySummary(documents);
      
      return {
        summary,
        documentCount: documents.length,
        documents: documents.map(doc => ({
          id: doc.id,
          filename: doc.filename,
          metadata: doc.metadata
        })),
        generatedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error generating policy summary:', error);
      throw error;
    }
  }

  /**
   * Get suggested questions for a customer
   * @param {string} customerId - Customer ID
   * @returns {Promise<Array<string>>} - Suggested questions
   */
  async getSuggestedQuestions(customerId) {
    try {
      const documents = this.vectorStore.getCustomerDocuments(customerId);
      if (documents.length === 0) {
        return [];
      }

      return await this.geminiService.generateSuggestedQuestions(documents);
    } catch (error) {
      console.error('Error generating suggested questions:', error);
      return [];
    }
  }

  /**
   * Get customer's documents
   * @param {string} customerId - Customer ID
   * @returns {Array<Object>} - Customer documents
   */
  getCustomerDocuments(customerId) {
    return this.vectorStore.getCustomerDocuments(customerId).map(doc => ({
      id: doc.id,
      filename: doc.filename,
      metadata: doc.metadata,
      chunkCount: doc.chunkIds.length
    }));
  }

  /**
   * Delete a customer's document
   * @param {string} customerId - Customer ID
   * @param {string} documentId - Document ID
   * @returns {Promise<boolean>} - Success status
   */
  async deleteDocument(customerId, documentId) {
    try {
      const document = this.vectorStore.getDocument(documentId);
      if (!document || document.customerId !== customerId) {
        return false;
      }

      return await this.vectorStore.deleteDocument(documentId);
    } catch (error) {
      console.error('Error deleting document:', error);
      throw error;
    }
  }

  /**
   * Get service statistics
   * @returns {Object} - Service statistics
   */
  getStats() {
    return this.vectorStore.getStats();
  }

  /**
   * Preprocess query to handle common typos and variations
   * @param {string} query - Original query
   * @returns {string} - Processed query
   */
  preprocessQuery(query) {
    if (!query || typeof query !== 'string') {
      return query;
    }

    let processed = query.toLowerCase().trim();

    // Common typo corrections for insurance terms
    const typoCorrections = {
      // Common typos
      'myb': 'my',
      'premim': 'premium',
      'premiun': 'premium',
      'premeium': 'premium',
      'coverd': 'covered',
      'coverge': 'coverage',
      'benifits': 'benefits',
      'benfits': 'benefits',
      'benifts': 'benefits',
      'policey': 'policy',
      'polcy': 'policy',
      'cliam': 'claim',
      'claime': 'claim',
      'hosiptal': 'hospital',
      'hospitl': 'hospital',
      'treatmnt': 'treatment',
      'treament': 'treatment',
      'matrnity': 'maternity',
      'maternty': 'maternity',
      'vaccintation': 'vaccination',
      'vacination': 'vaccination',
      'restor': 'restore',
      'restoe': 'restore',
      
      // Common variations
      'what is': 'what are',
      'tell me about': 'what are',
      'explain about': 'what are',
      'describe about': 'what are',
    };

    // Apply typo corrections
    Object.keys(typoCorrections).forEach(typo => {
      const correction = typoCorrections[typo];
      // Use word boundaries to avoid partial matches
      const regex = new RegExp(`\\b${typo}\\b`, 'gi');
      processed = processed.replace(regex, correction);
    });

    // Handle specific patterns that need better processing
    // "give me [something]" should be converted to "what is [something]" or "show me [something]"
    processed = processed.replace(/\bgive me\s+(policy\s+summary|summary|details|information|overview)\b/gi, 'what is $1');
    processed = processed.replace(/\bpolicy\s+summary\b/gi, 'policy overview details coverage benefits');
    processed = processed.replace(/\bsummary\b/gi, 'overview details information');
    
    // Handle generic "policy details" requests
    processed = processed.replace(/\bi\s+need\s+(policy\s+details|my\s+policy\s+details)\b/gi, 'policy summary overview coverage benefits details');
    processed = processed.replace(/\bpolicy\s+details\b/gi, 'policy summary overview coverage benefits premium');
    processed = processed.replace(/\bmy\s+policy\s+information\b/gi, 'policy summary overview coverage benefits details');
    
    // Handle health checkup booking/details queries
    processed = processed.replace(/\b(get\s+my|show\s+my|my)\s+(health\s+checkup|checkup)\s+(details?|information|status)\b/gi, 'health checkup booking appointment details status timeline');
    processed = processed.replace(/\bhealth\s+checkup\s+(details?|information|status)\b/gi, 'health checkup booking appointment details status timeline');
    
    // Handle member-related queries for better matching with the member premium table
    processed = processed.replace(/\bhow\s+many\s+members?\s+(are\s+)?(covered|insured|included)\b/gi, 'member details member ID premium breakdown family members');
    processed = processed.replace(/\bmembers?\s+(covered|insured|included)\s+in\s+(my\s+)?policy\b/gi, 'member details member ID premium breakdown family members');
    processed = processed.replace(/\bfamily\s+members?\b/gi, 'member details member ID premium breakdown');
    processed = processed.replace(/\btotal\s+members?\b/gi, 'member details member ID premium breakdown');

    // Normalize whitespace
    processed = processed.replace(/\s+/g, ' ').trim();

    // Log if query was modified
    if (processed !== query.toLowerCase().trim()) {
      console.log(`Query preprocessed: "${query}" -> "${processed}"`);
    }

    return processed;
  }

  /**
   * Enhance query with conversation context for better similarity search
   * @param {string} query - Original query
   * @param {string} customerId - Customer ID
   * @returns {string} - Enhanced query with context
   */
  enhanceQueryWithContext(query, customerId) {
    const conversationHistory = this.getConversationHistory(customerId, 2); // Get last 2 exchanges
    
    if (!conversationHistory || conversationHistory.length === 0) {
      return query;
    }

    const text = query.toLowerCase().trim();
    
    // Check if query has context references or is a contextual request
    const hasContextReferences = /\b(this|that|it|these|those|the process|the procedure|the benefit|the coverage)\b/.test(text);
      const isContextualRequest = /^(yes|yeah|yep)\s+(please\s+)?(give\s+me|show\s+me|tell\s+me)\s+(my|the)\s+(details?|summary|information)/i.test(text) ||
                                 /^(give\s+me|show\s+me|tell\s+me)\s+(my|the)\s+(details?|summary|information)/i.test(text) ||
                                 /^(my|the)\s+(details?|summary|information)/i.test(text) ||
                                 /^(details?|summary|information|overview)$/i.test(text) || // Single word contextual requests
                                 /^(emergency|planned|cashless|reimbursement)$/i.test(text) || // Claim type contextual requests
                                 /^(yes|yeah|yep|ok|okay)\s+(.*(?:nov|november|dec|december|jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october).*)/i.test(text); // Reschedule follow-up with dates
    
    if (!hasContextReferences && !isContextualRequest) {
      return query;
    }

    // Find the most recent assistant response that might contain the context
    const recentAssistantResponse = conversationHistory
      .filter(msg => msg.role === 'assistant')
      .slice(-1)[0]; // Get the most recent assistant response

    if (!recentAssistantResponse) {
      return query;
    }

    // Extract key terms from the assistant's response
    const assistantText = recentAssistantResponse.content.toLowerCase();
    let contextTerms = [];
    
    // Look for key insurance terms in the assistant's response
    const keyTermsRegex = /\b(claim|premium|coverage|benefit|policy|hospital|treatment|cashless|reimbursement|notification|documents|procedure|process)\b/g;
    const matches = assistantText.match(keyTermsRegex);
    
    if (matches) {
      contextTerms = [...new Set(matches)]; // Remove duplicates
    }

    // For contextual requests like "give me my details", add policy-related terms
    if (isContextualRequest) {
      // Check if it's a claim type contextual request
      if (/^(emergency|planned|cashless|reimbursement)$/i.test(text)) {
        const enhancedQuery = `${query} claim process procedure hospital treatment coverage`;
        console.log(`Enhanced claim contextual query: "${query}" -> "${enhancedQuery}"`);
        return enhancedQuery;
      } 
      // Check if it's a reschedule follow-up (like "yes 21 november" after being offered alternatives)
      else if (/^(yes|yeah|yep|ok|okay)\s+(.*(?:nov|november|dec|december|jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october).*)/i.test(text)) {
        const enhancedQuery = `reschedule health checkup to ${query}`;
        console.log(`Enhanced reschedule follow-up query: "${query}" -> "${enhancedQuery}"`);
        return enhancedQuery;
      }
      else {
        // Regular policy information request
        const enhancedQuery = `${query} policy summary coverage premium benefits details`;
        console.log(`Enhanced contextual query: "${query}" -> "${enhancedQuery}"`);
        return enhancedQuery;
      }
    }

    // Enhance the query by adding context terms
    if (contextTerms.length > 0) {
      const enhancedQuery = `${query} ${contextTerms.join(' ')}`;
      console.log(`Enhanced query: "${query}" -> "${enhancedQuery}"`);
      return enhancedQuery;
    }

    return query;
  }

  /**
   * Analyze query to determine its type and appropriate response
   * @param {string} query - Original query
   * @returns {Object} - Analysis result with type and response
   */
  analyzeQuery(query) {
    if (!query || typeof query !== 'string') {
      return {
        type: 'out_of_scope',
        response: 'Please ask me a question about your insurance policies. I\'m here to help you with your policy needs!'
      };
    }

    const text = query.toLowerCase().trim();

      // Conversational patterns that should get LLM-generated responses
      const conversationalPatterns = [
        // Thanks and acknowledgments (with optional punctuation and additional words)
        /^(thanks?|thank you|ty|thx)(\s+(so\s+much|a\s+lot|that\s+helps?|that's\s+helpful))?[!.]*$/,
        
        // OK responses (with optional punctuation)
        /^(ok|okay|alright|got it|understood)[!.]*$/,
        
        // Greetings (more flexible, with optional words and punctuation)
        /^(hi|hello|hey)(\s+(there|again|everyone|all))?[!.]*$/,
        /^(good\s+(morning|afternoon|evening))[!.]*$/,
        
        // Goodbyes (with optional punctuation)
        /^(bye|goodbye|see you|take care)(\s+(later|soon))?[!.]*$/,
        
        // Simple responses (with optional punctuation)
        /^(yes|no|yeah|yep|nope)[!.]*$/,
        /^(no\s+(thanks?|thank you|ty|thx))[!.]*$/,
      
      // Combined patterns
      /^(ok|okay)\s+(thanks?|thank you|ty|thx)[!.]*$/,
      /^(ok|okay)\s+(alright|good)\s+(thanks?|thank you|ty|thx)[!.]*$/,
      /^(alright|good)\s+(ok|okay)\s+(thanks?|thank you|ty|thx)[!.]*$/,
      /^(thanks?|thank you)\s+(bye|goodbye)[!.]*$/,
      /^(hi|hello|hey)\s+(there|again)[!.]*$/,
      
      // Thanks with additional context
      /^(thanks?|thank you),?\s+(that\s+helps?|that's\s+helpful|that's\s+great|perfect)[!.]*$/,
      /^(that\s+helps?|that's\s+helpful|perfect),?\s+(thanks?|thank you)[!.]*$/
    ];

    // Check for conversational patterns
    for (const pattern of conversationalPatterns) {
      if (pattern.test(text)) {
        return { type: 'conversational' };
      }
    }

    // Very short responses (1-3 characters) - treat as conversational
    if (text.length <= 3 && !text.match(/^(why|how|who|what|when|where)$/)) {
      return { type: 'conversational' };
    }

      // Check for reschedule requests first
      if (this.policyTimelineService.isRescheduleRequest(query)) {
        return { type: 'reschedule_request' };
      }

      // Check for hospital-related queries first (before other patterns)
      const hospitalPatterns = {
        hospitalDetails: /\b(details?|information|info|about|tell me about|get me details)\s*(for|about|of)?\s*([a-zA-Z\s]+(?:hospital|clinic|medical|centre|center|healthcare))/i,
        specificHospital: /\b([a-zA-Z\s]+(?:hospital|clinic|medical|centre|center|healthcare))/i,
      };

      // Exclude queries about existing bookings/appointments AND policy coverage questions - these should be timeline/policy queries
      const isBookingQuery = /\b(my|get\s+my|show\s+my)\s+(health\s+checkup|checkup|appointment|booking)\s+(details?|information|status|booking)/i.test(text) ||
                            /\b(health\s+checkup|checkup|appointment)\s+(booking\s+)?(details?|information|status)/i.test(text) ||
                            /\bget\s+my\s+(health\s+checkup|checkup|appointment|booking)/i.test(text);
      
      // Exclude policy coverage questions about health checkups
      const isPolicyCoverageQuery = /\b(do\s+i\s+have|is|am\s+i|are\s+we)\s+.*\b(health\s+checkup|checkup)\s+.*\b(covered|coverage|included|benefit|available|eligible)/i.test(text) ||
                                   /\b(health\s+checkup|checkup)\s+.*\b(covered|coverage|included|benefit|available|eligible)/i.test(text) ||
                                   /\b(covered|coverage|included|benefit|available|eligible)\s+.*\b(health\s+checkup|checkup)/i.test(text);
      
      // If it's a hospital query, treat it as policy_related so it gets processed
      if (!isBookingQuery && !isPolicyCoverageQuery && (hospitalPatterns.hospitalDetails.test(text) || 
          (hospitalPatterns.specificHospital.test(text) && (text.includes('details') || text.includes('info') || text.includes('about'))))) {
        return { type: 'policy_related' };
      }

    // Follow-up question patterns that reference previous context
    const followUpPatterns = [
      /^(explain|tell me about|what about|how about|can you explain|please explain)/,
      /(this|that|it|these|those)\s+(process|procedure|benefit|coverage|claim|policy)/,
      /^(more details?|in brief|briefly|summary|summarize)/,
      /(how does|what is|what are)\s+(this|that|it)/,
      /^(what|how|when|where|why)\s+(does|is|are|can|should)\s+(this|that|it)/,
      /^(brief|short|quick)\s+(explanation|summary|overview)/,
      /^(can you|could you|please)\s+(explain|tell|describe|clarify)/,
      
      // Context-aware affirmative responses that should be treated as policy queries
      /^(yes|yeah|yep)\s+(please\s+)?(give\s+me|show\s+me|tell\s+me)\s+(my|the)\s+(details?|summary|information|policy|coverage)/,
      /^(yes|yeah|yep)\s+(I\s+)?(want|need|would\s+like)\s+(my|the)\s+(details?|summary|information|policy|coverage)/,
      /^(please\s+)?(give\s+me|show\s+me|tell\s+me)\s+(my|the)\s+(details?|summary|information|policy|coverage)/,
      /^(my|the)\s+(details?|summary|information|policy|coverage)/,
    ];

    // Check for follow-up patterns - these should be treated as policy-related
    for (const pattern of followUpPatterns) {
      if (pattern.test(text)) {
        return { type: 'policy_related' };
      }
    }

    // Insurance/policy-related keywords - continue with normal processing
    const policyKeywords = [
      'policy', 'premium', 'coverage', 'cover', 'claim', 'benefit', 'insurance',
      'health', 'medical', 'dental', 'treatment', 'doctor',
      'cost', 'price', 'payment', 'amount', 'limit', 'maximum',
      'renew', 'cancel', 'change', 'update', 'modify',
      'details', 'summary', 'information', 'overview',
      'mera', 'mere', 'kitna', 'kya', 'paisa', 'rupaye'
    ];

    const hasKeywords = policyKeywords.some(keyword => 
      text.includes(keyword.toLowerCase())
    );

    if (hasKeywords) {
      return { type: 'policy_related' };
    }

    // Question patterns that are likely policy-related
    const questionPatterns = [
      /what.*cover/, /how.*much/, /when.*expire/, /where.*hospital/,
      /why.*claim/, /can.*i.*get/, /do.*i.*have/, /am.*i.*covered/,
      /is.*covered/, /how.*to.*claim/
    ];

    for (const pattern of questionPatterns) {
      if (pattern.test(text)) {
        return { type: 'policy_related' };
      }
    }

    // Clearly off-topic queries
    const offTopicKeywords = [
      'weather', 'sports', 'news', 'politics', 'cooking', 'recipe', 'movie', 'music',
      'travel', 'vacation', 'shopping', 'fashion', 'technology', 'programming'
    ];

    const hasOffTopicKeywords = offTopicKeywords.some(keyword => 
      text.includes(keyword.toLowerCase())
    );

    if (hasOffTopicKeywords) {
      return {
        type: 'out_of_scope',
        response: 'I\'m your personal policy assistant and can help with questions about your insurance policies, coverage, claims, and policy services. Please ask me something about your policy with us!'
      };
    }

    // Default: allow it (better to be helpful)
    return { type: 'policy_related' };
  }

  /**
   * Get claim document requirements for reimbursement claims
   * @param {string} claimType - Type of claim (default: 'reimbursement')
   * @returns {Object} - Document requirements with formatted list
   */
  getClaimDocumentRequirements(claimType = 'reimbursement') {
    if (claimType === 'reimbursement') {
      const documentList = this.claimDocumentService.getReimbursementDocumentList();
      const mandatoryDocs = this.claimDocumentService.getMandatoryDocuments();
      
      return {
        claimType,
        documentList,
        mandatoryDocuments: mandatoryDocs,
        isAvailable: this.claimDocumentService.isDocumentListAvailable(),
        totalCategories: this.claimDocumentService.claimDocuments?.documentList?.length || 0
      };
    }
    
    return {
      claimType,
      documentList: 'Document requirements not available for this claim type.',
      mandatoryDocuments: [],
      isAvailable: false,
      totalCategories: 0
    };
  }

  /**
   * Analyze if query is hospital-related and determine query type
   * @param {string} query - User query
   * @returns {Object} - Analysis result with query type and extracted parameters
   */
  analyzeHospitalQuery(query) {
    if (!query || typeof query !== 'string') {
      return { isHospitalRelated: false };
    }

    const text = query.toLowerCase().trim();

    // Exclude queries about existing bookings/appointments AND policy coverage questions - these should be timeline/policy queries
    const isBookingQuery = /\b(my|get\s+my|show\s+my)\s+(health\s+checkup|checkup|appointment|booking)\s+(details?|information|status|booking)/i.test(text) ||
                          /\b(health\s+checkup|checkup|appointment)\s+(booking\s+)?(details?|information|status)/i.test(text) ||
                          /\bget\s+my\s+(health\s+checkup|checkup|appointment|booking)/i.test(text);
    
    // Exclude policy coverage questions about health checkups
    const isPolicyCoverageQuery = /\b(do\s+i\s+have|is|am\s+i|are\s+we)\s+.*\b(health\s+checkup|checkup)\s+.*\b(covered|coverage|included|benefit|available|eligible)/i.test(text) ||
                                 /\b(health\s+checkup|checkup)\s+.*\b(covered|coverage|included|benefit|available|eligible)/i.test(text) ||
                                 /\b(covered|coverage|included|benefit|available|eligible)\s+.*\b(health\s+checkup|checkup)/i.test(text);
    
    if (isBookingQuery || isPolicyCoverageQuery) {
      return { isHospitalRelated: false };
    }

    // Hospital-related keywords and patterns
    const hospitalPatterns = {
      nearby: /\b(nearby|near|close|nearest|around|within|distance)\s+(hospital|clinic|medical|healthcare)/i,
      emergency: /\b(emergency|urgent|accident|critical|immediate|ambulance)\s*(hospital|medical|care)/i,
      network: /\b(network|cashless|covered|approved|empanelled|tie.?up)\s*(hospital|clinic)/i,
      search: /\b(hospital|clinic|medical center|healthcare)\s*(in|at|near|around)\s*([a-zA-Z\s\d]+)/i,
      hospitalDetails: /\b(details?|information|info|about|tell me about|get me details)\s*(for|about|of)?\s*([a-zA-Z\s]+(?:hospital|clinic|medical|centre|center|healthcare))/i,
      specificHospital: /\b([a-zA-Z\s]+(?:hospital|clinic|medical|centre|center|healthcare))/i,
      general: /\b(hospital|clinic|medical center|healthcare|doctor|treatment|checkup|health check)/i,
      location: /\b(mumbai|borivali|andheri|bandra|juhu|goregaon|malad|kandivali|dahisar|mira|vasai|thane|kurla|ghatkopar|powai|worli|lower parel|fort|colaba|churchgate|marine drive)\b/i,
      pincode: /\b(40\d{4})\b/,
      zone: /\b(west|east|north|south|central)\s*(mumbai|zone)/i
    };

    // Extract location information
    let location = null;
    let pincode = null;
    let zone = null;
    let searchTerm = null;

    // Check for pincode
    const pincodeMatch = text.match(hospitalPatterns.pincode);
    if (pincodeMatch) {
      pincode = pincodeMatch[1];
    }

    // Check for zone
    const zoneMatch = text.match(hospitalPatterns.zone);
    if (zoneMatch) {
      zone = zoneMatch[1];
    }

    // Check for location names
    const locationMatch = text.match(hospitalPatterns.location);
    if (locationMatch) {
      location = locationMatch[0];
      searchTerm = location;
    }

    // Determine query type and return analysis
    if (hospitalPatterns.emergency.test(text)) {
      return {
        isHospitalRelated: true,
        queryType: 'emergency',
        location,
        pincode,
        zone,
        searchTerm: searchTerm || 'emergency hospitals',
        priority: 'high'
      };
    }

    if (hospitalPatterns.nearby.test(text)) {
      return {
        isHospitalRelated: true,
        queryType: 'nearby',
        location,
        pincode,
        zone,
        searchTerm: searchTerm || location,
        needsLocation: !location && !pincode
      };
    }

    if (hospitalPatterns.network.test(text)) {
      return {
        isHospitalRelated: true,
        queryType: 'network',
        location,
        pincode,
        zone,
        searchTerm: searchTerm || 'network hospitals',
        networkType: 'Valued'
      };
    }

    if (hospitalPatterns.search.test(text)) {
      const searchMatch = text.match(hospitalPatterns.search);
      const extractedLocation = searchMatch ? searchMatch[3] : null;
      
      return {
        isHospitalRelated: true,
        queryType: 'search',
        location: extractedLocation || location,
        pincode,
        zone,
        searchTerm: extractedLocation || location || 'hospitals',
      };
    }

    // Check for specific hospital details requests
    if (hospitalPatterns.hospitalDetails.test(text)) {
      const detailsMatch = text.match(hospitalPatterns.hospitalDetails);
      const hospitalName = detailsMatch ? detailsMatch[3].trim() : null;
      
      return {
        isHospitalRelated: true,
        queryType: 'hospitalDetails',
        searchTerm: hospitalName,
        location,
        pincode,
        zone,
      };
    }

    // Check for mentions of specific hospitals
    if (hospitalPatterns.specificHospital.test(text) && (text.includes('details') || text.includes('info') || text.includes('about'))) {
      const hospitalMatch = text.match(hospitalPatterns.specificHospital);
      const hospitalName = hospitalMatch ? hospitalMatch[1].trim() : null;
      
      return {
        isHospitalRelated: true,
        queryType: 'hospitalDetails',
        searchTerm: hospitalName,
        location,
        pincode,
        zone,
      };
    }

    if (hospitalPatterns.general.test(text)) {
      return {
        isHospitalRelated: true,
        queryType: 'general',
        location,
        pincode,
        zone,
        searchTerm: searchTerm || 'hospitals',
      };
    }

    return { isHospitalRelated: false };
  }

  /**
   * Get hospital recommendations based on query analysis
   * @param {Object} hospitalQuery - Hospital query analysis result
   * @returns {Object} - Hospital recommendations object
   */
  getHospitalRecommendations(hospitalQuery) {
    if (!this.hospitalService.isDataAvailable()) {
      return {
        isAvailable: false,
        hospitalList: 'Hospital information is currently unavailable. Please contact our customer service team.',
        title: 'Hospital Information'
      };
    }

    const options = {
      searchTerm: hospitalQuery.searchTerm,
      pincode: hospitalQuery.pincode,
      zone: hospitalQuery.zone,
      networkType: hospitalQuery.networkType || 'Valued',
      limit: hospitalQuery.queryType === 'emergency' ? 8 : 10
    };

    // For nearby queries, we might need to handle location coordinates
    // For now, we'll search by area name
    if (hospitalQuery.queryType === 'nearby' && hospitalQuery.location) {
      options.searchTerm = hospitalQuery.location;
    }

    let recommendations;

    switch (hospitalQuery.queryType) {
      case 'emergency':
        recommendations = this.hospitalService.getHospitalRecommendations('emergency', options);
        break;

      case 'nearby':
        if (hospitalQuery.needsLocation) {
          return {
            isAvailable: true,
            hospitalList: 'To find nearby hospitals, please specify your location (area name or pincode) in Mumbai. For example: "hospitals near Andheri" or "hospitals in 400058".',
            title: 'Location Required',
            needsLocation: true
          };
        }
        
        if (hospitalQuery.pincode) {
          recommendations = this.hospitalService.getHospitalRecommendations('area', { ...options, pincode: hospitalQuery.pincode });
        } else {
          recommendations = this.hospitalService.getHospitalRecommendations('search', options);
        }
        break;

      case 'network':
        recommendations = this.hospitalService.getHospitalRecommendations('network', options);
        break;

      case 'search':
        if (hospitalQuery.pincode) {
          recommendations = this.hospitalService.getHospitalRecommendations('area', { ...options, pincode: hospitalQuery.pincode });
        } else if (hospitalQuery.zone) {
          recommendations = this.hospitalService.getHospitalRecommendations('zone', { ...options, zone: hospitalQuery.zone });
        } else {
          recommendations = this.hospitalService.getHospitalRecommendations('search', options);
        }
        break;

      case 'hospitalDetails':
        // Search for specific hospital by name
        recommendations = this.hospitalService.getHospitalRecommendations('search', { 
          ...options, 
          searchTerm: hospitalQuery.searchTerm,
          limit: 5 // Limit to fewer results for specific searches
        });
        break;

      default:
        recommendations = this.hospitalService.getHospitalRecommendations('network', options);
    }

    return {
      isAvailable: recommendations.isAvailable,
      hospitalList: recommendations.formattedList,
      title: recommendations.title,
      count: recommendations.count,
      queryType: hospitalQuery.queryType,
      priority: hospitalQuery.priority
    };
  }

  /**
   * Search across all customer documents (admin function)
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Array<Object>>} - Search results
   */
  async searchAllDocuments(query, options = {}) {
    try {
      const { topK = 10, similarityThreshold = 0.5 } = options;
      
      // Generate query embedding
      const queryEmbeddingResult = await this.embeddingService.generateEmbedding(query);
      
      // Get all chunks
      const allChunks = Array.from(this.vectorStore.chunks.values());
      
      // Calculate similarities
      const similarities = allChunks.map(chunk => ({
        ...chunk,
        similarity: this.vectorStore.calculateCosineSimilarity(queryEmbeddingResult.values, chunk.embedding)
      }));

      return similarities
        .filter(chunk => chunk.similarity >= similarityThreshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, topK);
    } catch (error) {
      console.error('Error searching all documents:', error);
      throw error;
    }
  }
}

module.exports = CustomerService;
