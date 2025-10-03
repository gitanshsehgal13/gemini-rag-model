const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiService {
  constructor(apiKey) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' }); // Using Gemini 2.0 Flash experimental
    
    // Configuration for text generation
    this.generationConfig = {
      temperature: 0.3,
      topK: 40,
      topP: 0.8,
      maxOutputTokens: 1024,
    };
    
    // Response caching to reduce API calls
    this.responseCache = new Map();
    this.conversationalCache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Generate cache key for responses
   * @param {string} query - User query
   * @param {string} customerId - Customer ID
   * @param {Array} relevantChunks - Relevant chunks
   * @returns {string} - Cache key
   */
  generateCacheKey(query, customerId, relevantChunks = []) {
    const chunkIds = relevantChunks.map(chunk => chunk.id).sort().join(',');
    return `${customerId}:${query.toLowerCase().trim()}:${chunkIds}`;
  }

  /**
   * Check if cache entry is valid
   * @param {Object} cacheEntry - Cache entry
   * @returns {boolean} - Whether cache is valid
   */
  isCacheValid(cacheEntry) {
    if (!cacheEntry) return false;
    return (Date.now() - cacheEntry.timestamp) < this.cacheExpiry;
  }

  /**
   * Get cached response if available and valid
   * @param {string} cacheKey - Cache key
   * @param {Map} cache - Cache map to use
   * @returns {Object|null} - Cached response or null
   */
  getCachedResponse(cacheKey, cache = this.responseCache) {
    const cacheEntry = cache.get(cacheKey);
    if (this.isCacheValid(cacheEntry)) {
      console.log('Cache hit - returning cached response');
      return cacheEntry.response;
    }
    if (cacheEntry) {
      cache.delete(cacheKey); // Remove expired entry
    }
    return null;
  }

  /**
   * Cache response
   * @param {string} cacheKey - Cache key
   * @param {Object} response - Response to cache
   * @param {Map} cache - Cache map to use
   */
  cacheResponse(cacheKey, response, cache = this.responseCache) {
    cache.set(cacheKey, {
      response: response,
      timestamp: Date.now()
    });
  }

  /**
   * Generate content with retry logic for rate limits and service unavailability
   * @param {Object} requestConfig - Request configuration for generateContent
   * @returns {Promise<Object>} - Generated content result
   */
  async generateContentWithRetry(requestConfig, maxRetries = 3) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.model.generateContent(requestConfig);
      } catch (error) {
        lastError = error;
        
        // Check if it's a retryable error
        const isRetryable = error.status === 429 || // Rate limit
                           error.status === 503 || // Service unavailable
                           error.status === 502;   // Bad gateway
        
        if (!isRetryable || attempt === maxRetries) {
          break;
        }
        
        // Calculate exponential backoff delay
        const baseDelay = 1000; // 1 second
        const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
        
        console.log(`API error (${error.status}), retrying in ${Math.round(delay)}ms... (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // If we get here, all retries failed
    console.error('All retry attempts failed:', lastError);
    throw lastError;
  }

  /**
   * Generate response using retrieved context and user query
   * @param {string} query - User query
   * @param {Array<Object>} relevantChunks - Retrieved relevant chunks
   * @param {string} customerId - Customer ID for personalization
   * @param {Array<Object>} conversationHistory - Recent conversation history for context
   * @param {Object} claimDocuments - Optional claim document requirements
   * @param {Object} hospitalRecommendations - Optional hospital recommendations
   * @returns {Promise<Object>} - Generated response with metadata
   */
  async generateResponse(query, relevantChunks, customerId, conversationHistory = [], claimDocuments = null, hospitalRecommendations = null) {
    try {
      // Check cache first (only for simple policy queries without conversation history)
      const shouldCache = conversationHistory.length === 0 && !claimDocuments && !hospitalRecommendations;
      let cacheKey = null;
      
      if (shouldCache) {
        cacheKey = this.generateCacheKey(query, customerId, relevantChunks);
        const cachedResponse = this.getCachedResponse(cacheKey);
        if (cachedResponse) {
          return cachedResponse;
        }
      }
      
      const context = this.buildContext(relevantChunks);
      
      // Detect the language of the input query using local detection
      const detectedLanguage = this.detectLanguageLocal(query);
      
      const prompt = this.buildPrompt(query, context, customerId, detectedLanguage, conversationHistory, claimDocuments, hospitalRecommendations);
      
      console.log('Making Gemini API call for policy response...');
      const result = await this.generateContentWithRetry({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: this.generationConfig
      });

      const response = result.response;
      const text = response.text();

      const finalResponse = {
        answer: text,
        sourceChunks: relevantChunks.map(chunk => ({
          documentId: chunk.documentId,
          chunkId: chunk.id,
          similarity: chunk.similarity,
          text: chunk.text.substring(0, 200) + '...'
        })),
        confidence: this.calculateConfidence(relevantChunks),
        generatedAt: new Date().toISOString()
      };
      
      // Cache the response if appropriate
      if (shouldCache && cacheKey) {
        this.cacheResponse(cacheKey, finalResponse);
      }
      
      return finalResponse;
    } catch (error) {
      console.error('Error generating response:', error);
      throw error;
    }
  }

  /**
   * Build context from relevant chunks
   * @param {Array<Object>} chunks - Relevant chunks
   * @returns {string} - Formatted context
   */
  buildContext(chunks) {
    if (!chunks || chunks.length === 0) {
      return 'No relevant policy information found.';
    }

    let context = 'Relevant Policy Information:\n\n';
    
    chunks.forEach((chunk, index) => {
      // Clean the chunk text by removing common document artifacts
      const cleanedText = this.cleanDocumentText(chunk.text);
      context += `[Source ${index + 1}]:\n${cleanedText}\n\n`;
    });

    return context;
  }

  /**
   * Clean document text by removing formatting artifacts and metadata
   * @param {string} text - Raw text from document chunk
   * @returns {string} - Cleaned text
   */
  cleanDocumentText(text) {
    if (!text) return '';
    
    let cleaned = text;
    
    // Remove common document artifacts and patterns
    const unwantedPatterns = [
      // Registration and regulatory information
      /IRDA of India Registration No[:\s]*\d+/gi,
      /CIN[:\s]*[A-Z0-9]+/gi,
      /UIN[:\s]*[A-Z0-9]+/gi,
      
      // Page references
      /Page \d+ of \d+/gi,
      
      // Company addresses and contact info (unless it's the main content)
      /Peninsula Business Park[^.]*Mumbai[^.]*Maharashtra[^.]*India[^.]*/gi,
      
      // Document formatting artifacts
      /•\s*Email:\s*[^\s]+@[^\s]+/gi,
      /•\s*Website:\s*www\.[^\s]+/gi,
      /24x7 Toll Free No[^.]*\d+/gi,
      
      // Null characters and formatting issues
      /\u0000/g,
      
      // Multiple spaces and line breaks
      /\s+/g,
    ];
    
    // Apply pattern removals
    unwantedPatterns.forEach((pattern, index) => {
      if (index === unwantedPatterns.length - 1) {
        // Last pattern is the whitespace pattern - replace with single space
        cleaned = cleaned.replace(pattern, ' ');
      } else {
        // For other patterns, remove completely
        cleaned = cleaned.replace(pattern, '');
      }
    });
    
    // Clean up extra spaces and trim
    cleaned = cleaned.trim();
    
    // Remove any lines that are just metadata or formatting
    const lines = cleaned.split('\n');
    const filteredLines = lines.filter(line => {
      const trimmedLine = line.trim();
      
      // Skip empty lines
      if (!trimmedLine) return false;
      
      // Skip lines that are just document artifacts
      if (trimmedLine.match(/^(TATA AIG|DocIt Draft|Registered office)/i)) return false;
      if (trimmedLine.match(/^\d+\s*•/)) return false; // Bullet point numbers only
      if (trimmedLine.length < 10) return false; // Very short lines are likely artifacts
      
      return true;
    });
    
    return filteredLines.join('\n').trim();
  }

  /**
   * Build prompt for Gemini AI
   * @param {string} query - User query
   * @param {string} context - Retrieved context
   * @param {string} customerId - Customer ID
   * @param {string} detectedLanguage - Detected language of the query
   * @returns {string} - Formatted prompt
   */
  buildPrompt(query, context, customerId, detectedLanguage = 'English', conversationHistory = [], claimDocuments = null, hospitalRecommendations = null) {
    // Build conversation context if available
    let conversationContext = '';
    if (conversationHistory && conversationHistory.length > 0) {
      conversationContext = '\nOur Recent Conversation:\n';
      conversationHistory.forEach(msg => {
        const role = msg.role === 'user' ? 'You' : 'Your Personal Assistant';
        conversationContext += `${role}: ${msg.content}\n`;
      });
      conversationContext += '\n';
    }

    // Build claim documents context if available
    let claimDocumentsContext = '';
    if (claimDocuments && claimDocuments.isAvailable) {
      claimDocumentsContext = '\nClaim Document Requirements:\n';
      claimDocumentsContext += claimDocuments.documentList + '\n\n';
    }

    // Build hospital recommendations context if available
    let hospitalContext = '';
    if (hospitalRecommendations && hospitalRecommendations.isAvailable) {
      hospitalContext = `\n${hospitalRecommendations.title}:\n`;
      hospitalContext += hospitalRecommendations.hospitalList + '\n\n';
    }

    return `You are my personal insurance assistant. I am your valued policyholder, and you help me with all my policy-related needs and servicing requests after policy issuance.

My Customer ID: ${customerId}${conversationContext}
My Policy Information:
${context}${claimDocumentsContext}${hospitalContext}
My Question: ${query}

Your Role & Instructions:
1. You are MY personal policy assistant - speak directly to me as "you" and refer to the insurance company as "us" or "we"
2. Answer my questions based ONLY on my policy information provided above
3. If we have recent conversation history, use it to understand context and references (like "this process", "that", "it", etc.)
4. Be warm, personal, and helpful - like a dedicated personal assistant who knows my policies inside out
5. For policy servicing needs (claims, payments, policy changes, renewals), guide me on next steps and offer to help coordinate with our teams
6. Always use personal language: "your policy", "with us", "we can help you", "let me assist you"
7. FRIENDLY TONE: Speak naturally like a knowledgeable friend, not like you're reading from documents. Use phrases like "I can see that you have", "your policy includes", "you're covered for" instead of formal document references
8. If my policy information doesn't have enough details, say "Let me check with our team for more specific details about your policy"
9. Include relevant policy numbers, coverage details, or specific terms from MY policy when applicable
10. Maintain a caring, empathetic, and professional tone - like a trusted personal advisor
11. GREETING RULES: If we have recent conversation history, DON'T start with "Hi there!" or "Hey there!" - continue the conversation naturally. Only use greetings for the first interaction or after a long break.
12. SMART ASSISTANCE: Since I have access to your complete policy documents and information, I already have your policy details, card information, coverage amounts, and policy numbers. Don't ask for information I already have (like your name, contact details, or policy information) - instead, focus ONLY on what I still need from you (like hospital name, treatment type, or emergency specifics) to help you efficiently.
13. EMERGENCY RESPONSE: If the query indicates a medical emergency, be EXTRA empathetic, keep responses crisp and action-focused, prioritize immediate help, and avoid repetitive information or lengthy explanations. Focus on what they need to do RIGHT NOW. For emergencies, don't just mention the 24-hour rule - actively help them start the process immediately and offer to coordinate with the hospital and teams right away.
14. PROACTIVE EMERGENCY HELP: For emergencies, say things like "I'm starting your pre-authorization now", "I'll coordinate with the hospital immediately", "Let me get this processed urgently for you" - be proactive, not just informative.
15. EMERGENCY INFO FOCUS: For emergencies, ONLY ask for: hospital name/location, type of treatment/emergency, and when it occurred. DO NOT ask for customer name, doctor names, contact details, or other information that's not immediately essential for starting the claim process.
16. DOCUMENT UPLOAD ASSISTANCE: When customers ask about uploading documents, be proactive and helpful. Say "Yes, you can upload all your documents here! I'll organize them by category, check for completeness, and submit them for processing. Just upload everything you have and I'll handle the rest."
17. HOSPITAL RECOMMENDATIONS: When customers ask about hospitals, network hospitals, nearby hospitals, or emergency care, provide specific hospital recommendations from the Hospital Information section above. Include hospital names, addresses, network status, and zones. For emergencies, prioritize accessibility and network coverage. Always mention that these are network hospitals where cashless treatment is available.
    - For specific hospital queries (like "details for Ruby Medical Centre"), provide a personalized response about that specific hospital using the information provided.
    - Use natural language like "I found Ruby Medical Centre for you" instead of generic "Here are X hospitals".
18. CASHLESS VS REIMBURSEMENT CLAIMS: 
    - For CASHLESS claims: Focus ONLY on pre-authorization, hospital coordination, and getting treatment approved. DO NOT ask for document uploads - the hospital handles all documentation directly with us.
    - For REIMBURSEMENT claims: Guide them on document collection and upload process since they need to submit documents for processing.
    - If claim type is unclear, ask whether they want cashless (no upfront payment) or reimbursement (pay first, get refunded) to provide the right guidance.

IMPORTANT - Content Filtering Rules:
- DO NOT include document formatting artifacts like "Page X of Y", "IRDA Registration No", "CIN:", "UIN:", etc.
- DO NOT include company registration details, addresses, or regulatory numbers in responses
- DO NOT include email addresses, phone numbers, or website URLs unless I specifically ask for contact information
- DO NOT include document headers, footers, or metadata
- DO NOT reference document names like "Customer Information Sheet", "Policy Schedule", "as per your CIS", etc.
- DO NOT use technical references like "Source 1", "Source 2", "(Source X)" in responses
- Focus ONLY on the substantive policy content that answers my question
- Present information in a clean, readable format without document artifacts
- AVOID REPETITIVE INFORMATION: Don't repeat the same policy exclusions, terms, or details multiple times in a single response
- SPEAK NATURALLY: Use conversational language like "your policy shows", "I can see that", "according to your coverage" instead of citing document sources

LANGUAGE REQUIREMENT:
- I asked my question in: ${detectedLanguage}
- You MUST respond in the SAME language as my question
- If the detected language is not English, provide your entire response in that language
- Maintain the same level of formality and tone as my original question
- Use natural, fluent expressions in the target language

My Personal Policy Assistant Response:`;
  }

  /**
   * Detect the language of the input query using local pattern matching
   * @param {string} query - User query
   * @returns {string} - Detected language
   */
  detectLanguageLocal(query) {
    if (!query || typeof query !== 'string') {
      return 'English';
    }

    const text = query.toLowerCase().trim();

    // Hindi language patterns and common words
    const hindiPatterns = {
      // Common Hindi words in Roman script (only actual Hindi words, not English words)
      // Removed ambiguous words like "me", "the" that could be English
      words: [
        'mera', 'meri', 'mere', 'main', 'mai', 'hoon', 'hai', 'hain', 'ka', 'ki', 'ke', 'ko', 'se', 'par',
        'aur', 'ya', 'nahi', 'nahin', 'kya', 'kaise', 'kahan', 'kab', 'kyun', 'kitna', 'kitne', 'kitni',
        'hoga', 'hogi', 'hoge', 'chahiye', 'chahie', 'paisa', 'paise', 'rupaye',
        'bhi', 'jo', 'jis', 'jin', 'jab', 'tab', 'yah', 'yeh', 'vah', 'vo', 'woh', 'iske', 'uske', 'unka', 'unki',
        'apna', 'apne', 'apni', 'hamara', 'hamare', 'hamari', 'tumhara', 'tumhare', 'tumhari'
      ],
      // Devanagari script detection
      devanagari: /[\u0900-\u097F]/
    };

    // Spanish patterns
    const spanishPatterns = {
      words: ['mi', 'mis', 'el', 'la', 'los', 'las', 'es', 'son', 'de', 'del', 'en', 'con', 'por', 'para',
              'que', 'como', 'cuando', 'donde', 'porque', 'cuanto', 'cual', 'prima', 'poliza', 'seguro']
    };

    // French patterns
    const frenchPatterns = {
      words: ['mon', 'ma', 'mes', 'le', 'la', 'les', 'est', 'sont', 'de', 'du', 'dans', 'avec', 'pour',
              'que', 'comment', 'quand', 'où', 'pourquoi', 'combien', 'prime', 'police', 'assurance']
    };

    // Check for Devanagari script (Hindi)
    if (hindiPatterns.devanagari.test(text)) {
      console.log(`Language detected: "${query}" -> Hindi (Devanagari script)`);
      return 'Hindi';
    }

    // Check for Hindi words (Roman script)
    const hindiWordCount = hindiPatterns.words.filter(word => 
      new RegExp(`\\b${word}\\b`, 'i').test(text)
    ).length;

    // Check for Spanish words
    const spanishWordCount = spanishPatterns.words.filter(word => 
      new RegExp(`\\b${word}\\b`, 'i').test(text)
    ).length;

    // Check for French words
    const frenchWordCount = frenchPatterns.words.filter(word => 
      new RegExp(`\\b${word}\\b`, 'i').test(text)
    ).length;

    // Determine language based on word matches
    const wordCounts = [
      { language: 'Hindi', count: hindiWordCount },
      { language: 'Spanish', count: spanishWordCount },
      { language: 'French', count: frenchWordCount }
    ];

    // Sort by count and get the highest
    wordCounts.sort((a, b) => b.count - a.count);
    const topMatch = wordCounts[0];

    // Require at least 3 matching words for non-English detection to avoid false positives
    if (topMatch.count >= 3) {
      console.log(`Language detected: "${query}" -> ${topMatch.language} (${topMatch.count} matching words)`);
      return topMatch.language;
    }

    // Default to English
    return 'English';
  }

  /**
   * Generate a natural conversational response
   * @param {string} query - User's conversational input
   * @param {string} customerId - Customer ID for context
   * @param {Array} conversationHistory - Recent conversation history
   * @returns {Promise<string>} - Natural conversational response
   */
  async generateConversationalResponse(query, customerId, conversationHistory = []) {
    try {
      // Check for simple static responses first to avoid API calls
      const staticResponse = this.getStaticConversationalResponse(query);
      if (staticResponse) {
        console.log('Using static conversational response (no API call)');
        return staticResponse;
      }
      
      // Check cache for more complex conversational responses
      const cacheKey = `${customerId}:${query.toLowerCase().trim()}:conv`;
      const cachedResponse = this.getCachedResponse(cacheKey, this.conversationalCache);
      if (cachedResponse) {
        return cachedResponse;
      }
      
      // Build conversation context
      let contextString = '';
      if (conversationHistory && conversationHistory.length > 0) {
        contextString = '\nRecent conversation:\n';
        conversationHistory.forEach(msg => {
          const role = msg.role === 'user' ? 'You' : 'Your Personal Assistant';
          contextString += `${role}: ${msg.content}\n`;
        });
        contextString += '\n';
      }

      const prompt = `You are my personal insurance assistant. I am your valued policyholder, and you're here to help me with all my policy needs. ${contextString}I just said: "${query}"

Respond naturally and warmly as my dedicated personal policy assistant would. Keep your response:
- Brief and conversational (1-2 sentences)
- Warm, personal, and caring
- Use "you", "your policy", "with us", "we" language to make it personal
- Natural and human-like, not robotic
- Consider our conversation context if provided

Examples:
- If I say "thanks" → "You're so welcome! I'm always here to help with your policy needs."
- If I say "hi" → "Hello! How can I assist you with your policy today?"
- If I say "yes" after asking if I need help → "Perfect! What would you like to know about your policy with us?"
- If I say "ok thanks" → "You're very welcome! I'm here whenever you need assistance with your policy."

My Personal Assistant Response:`;

      console.log('Making Gemini API call for conversational response...');
      const result = await this.generateContentWithRetry({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 150
        }
      });

      const response = result.response.text().trim();
      
      // Cache the response
      this.cacheResponse(cacheKey, response, this.conversationalCache);
      
      return response;
    } catch (error) {
      console.error('Error generating conversational response:', error);
      // Fallback to a simple response if API fails
      return this.getStaticConversationalResponse(query) || "I'm here to help with your insurance policy questions!";
    }
  }

  /**
   * Get static conversational response for common queries (no API call needed)
   * @param {string} query - User query
   * @returns {string|null} - Static response or null if no match
   */
  getStaticConversationalResponse(query) {
    const normalizedQuery = query.toLowerCase().trim();
    
    // Common greetings
    if (/^(hi|hello|hey)(\s+there)?[!.]*$/i.test(normalizedQuery)) {
      return "Hello! How can I assist you with your policy today?";
    }
    
    // Thanks responses
    if (/^(thanks?|thank you|ty|thx)(\s+(so\s+much|a\s+lot))?[!.]*$/i.test(normalizedQuery)) {
      return "You're so welcome! I'm always here to help with your policy needs.";
    }
    
    // No thanks responses
    if (/^(no\s+(thanks?|thank you|ty|thx))[!.]*$/i.test(normalizedQuery)) {
      return "No problem at all! Feel free to reach out whenever you need help with your policy.";
    }
    
    // OK responses
    if (/^(ok|okay|alright|got it)(\s+(thanks?|thank you))?[!.]*$/i.test(normalizedQuery)) {
      return "Perfect! Is there anything else I can help you with regarding your policy?";
    }
    
    // Combined responses
    if (/^(ok|okay)\s+(thanks?|thank you)[!.]*$/i.test(normalizedQuery)) {
      return "You're very welcome! I'm here whenever you need assistance with your policy.";
    }
    
    // Goodbye responses
    if (/^(bye|goodbye|see you|take care)(\s+(later|soon))?[!.]*$/i.test(normalizedQuery)) {
      return "Take care! Remember, I'm always here to help with your policy questions.";
    }
    
    // Simple yes/no
    if (/^(yes|yeah|yep|no|nope)[!.]*$/i.test(normalizedQuery)) {
      return "Got it! What would you like to know about your policy?";
    }
    
    return null; // No static response available
  }

  /**
   * Generate a summary of policy documents for a customer
   * @param {Array<Object>} documents - Customer's policy documents
   * @returns {Promise<string>} - Policy summary
   */
  async generatePolicySummary(documents) {
    try {
      if (!documents || documents.length === 0) {
        return 'No policy documents found for this customer.';
      }

      const documentContent = documents.map(doc => {
        return `Document: ${doc.filename}\nContent: ${doc.content.substring(0, 2000)}...`;
      }).join('\n\n');

      const prompt = `Please provide a comprehensive summary of the following insurance policy documents. Include key information such as:

1. Policy types and coverage
2. Policy numbers
3. Coverage limits and deductibles
4. Key terms and conditions
5. Important dates (effective dates, renewal dates)
6. Premium information if available

Policy Documents:
${documentContent}

Please provide a clear, organized summary:`;

      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          ...this.generationConfig,
          maxOutputTokens: 2048
        }
      });

      return result.response.text();
    } catch (error) {
      console.error('Error generating policy summary:', error);
      throw error;
    }
  }

  /**
   * Generate policy-specific questions that customers might ask
   * @param {Array<Object>} documents - Customer's policy documents
   * @returns {Promise<Array<string>>} - Suggested questions
   */
  async generateSuggestedQuestions(documents) {
    try {
      if (!documents || documents.length === 0) {
        return [];
      }

      const documentContent = documents.map(doc => {
        return `${doc.filename}: ${doc.content.substring(0, 1000)}...`;
      }).join('\n\n');

      const prompt = `Based on the following insurance policy documents, generate 8-10 relevant questions that a customer might ask about their policies. Focus on practical questions about coverage, claims, payments, and policy management.

Policy Documents:
${documentContent}

Generate questions in the following format:
1. Question about coverage
2. Question about claims
3. Question about payments
etc.

Questions:`;

      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: this.generationConfig
      });

      const response = result.response.text();
      const questions = response
        .split('\n')
        .filter(line => line.trim() && /^\d+\./.test(line.trim()))
        .map(line => line.replace(/^\d+\.\s*/, '').trim())
        .filter(q => q.length > 0);

      return questions;
    } catch (error) {
      console.error('Error generating suggested questions:', error);
      return [];
    }
  }

  /**
   * Calculate confidence score based on retrieved chunks
   * @param {Array<Object>} chunks - Retrieved chunks with similarity scores
   * @returns {number} - Confidence score (0-1)
   */
  calculateConfidence(chunks) {
    if (!chunks || chunks.length === 0) {
      return 0;
    }

    // Calculate average similarity score
    const avgSimilarity = chunks.reduce((sum, chunk) => sum + chunk.similarity, 0) / chunks.length;
    
    // Factor in number of chunks (more relevant chunks = higher confidence)
    const chunkFactor = Math.min(chunks.length / 5, 1); // Cap at 5 chunks
    
    // Combine similarity and chunk count
    const confidence = (avgSimilarity * 0.7) + (chunkFactor * 0.3);
    
    return Math.round(confidence * 100) / 100;
  }

  /**
   * Check if a query is policy-related
   * @param {string} query - User query
   * @returns {Promise<boolean>} - Whether query is policy-related
   */
  async isPolicyRelatedQuery(query) {
    try {
      const prompt = `Determine if the following question is related to insurance policies, coverage, claims, premiums, or insurance services. Answer with only "YES" or "NO".

Question: ${query}

Answer:`;

      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 10
        }
      });

      const response = result.response.text().trim().toUpperCase();
      return response === 'YES';
    } catch (error) {
      console.error('Error checking query relevance:', error);
      return true; // Default to true to be safe
    }
  }
}

module.exports = GeminiService;
