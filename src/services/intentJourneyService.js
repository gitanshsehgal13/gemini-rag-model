const fs = require("fs-extra");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const CommunicationService = require("./communicationService");
const SchedulingAgent = require("./schedulingAgent");
const ClaimInitiationService = require("./claimInitiationService");
const ConversationOrchestrator = require("./conversationOrchestrator");
const HealthCheckupJourneyService = require("./healthCheckupJourneyService");

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
    this.conversationStates = new Map(); // Store conversation state (stage, collected data) by conversationId
    this.orchestrators = new Map(); // Store orchestrator instance per intent
    this.healthCheckupService = null; // Separate service for health checkup journey
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
      const intentsPath = path.join(
        __dirname,
        "../../data/intentBasedJouneys.json"
      );
      this.intentsData = JSON.parse(fs.readFileSync(intentsPath, "utf8"));
      console.log(`Loaded ${this.intentsData.length} intent definitions`);

      // Initialize orchestrators for each intent
      this.intentsData.forEach((intent) => {
        if (intent.conversationFlow) {
          this.orchestrators.set(
            intent.intent,
            new ConversationOrchestrator(intent)
          );
          console.log(`Initialized orchestrator for intent: ${intent.intent}`);
        }
      });

      // Initialize health checkup service separately
      this.healthCheckupService = new HealthCheckupJourneyService(
        this.geminiService,
        this.hospitalService
      );
      console.log(`Initialized health checkup journey service`);
    } catch (error) {
      console.error("Error loading intents data:", error);
      this.intentsData = [];
    }
  }

  /**
   * Load policy information from JSON file
   */
  loadPolicyInfo() {
    try {
      const policyInfoPath = path.join(__dirname, "../../data/policyInfo.json");
      this.policyInfo = JSON.parse(fs.readFileSync(policyInfoPath, "utf8"));
      console.log(
        `Loaded policy information for ${this.policyInfo.policyholder}`
      );
    } catch (error) {
      console.error("Error loading policy info:", error);
      this.policyInfo = null;
    }
  }

  /**
   * Get intent configuration by intent name
   * @param {string} intentName - Intent name
   * @returns {Object|null} - Intent configuration
   */
  getIntentConfig(intentName) {
    // Check main intents data first
    const mainIntent = this.intentsData.find(
      (intent) => intent.intent === intentName
    );
    if (mainIntent) {
      return mainIntent;
    }

    // Check health checkup service for HEALTH_CHECKUP_BOOKING_JOURNEY
    if (
      intentName === "HEALTH_CHECKUP_BOOKING_JOURNEY" &&
      this.healthCheckupService
    ) {
      return this.healthCheckupService.getIntentData();
    }

    return null;
  }

  /**
   * @deprecated LEGACY METHOD - Use processIntentJourneyWithOrchestrator() instead
   *
   * This method uses prompt-based flow control and pattern matching (isHospitalAdmission checks).
   * The new Orchestrator architecture provides deterministic, stage-based flow control.
   *
   * Start or continue an intent-based journey
   * @param {string} customerId - Customer ID
   * @param {string} intentName - Intent name
   * @param {string} query - Customer query/message
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Journey response
   */
  async processIntentJourney(customerId, intentName, query, options = {}) {
    try {
      console.log(
        `\n🎯 Processing Intent Journey: ${intentName} for customer: ${customerId}`
      );

      // Route to appropriate service based on intent
      if (intentName === "HEALTH_CHECKUP_BOOKING_JOURNEY") {
        console.log("🏥 Routing to Health Checkup Journey Service");
        return await this.healthCheckupService.processHealthCheckupQuery(
          customerId,
          query,
          options
        );
      } else {
        console.log("🏥 Routing to Main Orchestrator Service");
        return await this.processIntentJourneyWithOrchestrator(
          customerId,
          intentName,
          query,
          options
        );
      }
    } catch (error) {
      console.error("Error processing intent journey:", error);
      throw error;
    }
  }

  /**
   * @deprecated LEGACY METHOD - Use processIntentJourneyWithOrchestrator() instead
   *
   * This method uses prompt-based flow control and pattern matching (isHospitalAdmission checks).
   * The new Orchestrator architecture provides deterministic, stage-based flow control.
   *
   * Start or continue an intent-based journey
   * @param {string} customerId - Customer ID
   * @param {string} intentName - Intent name
   * @param {string} query - Customer query/message
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Journey response
   */
  async processIntentJourneyLegacy(
    customerId,
    intentName,
    query,
    options = {}
  ) {
    try {
      console.log(
        `Processing intent journey for customer ${customerId}, intent: ${intentName}`
      );

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
          status: "active",
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.customerJourneys.set(customerId, journeyData);
        this.conversationHistories.set(conversationId, []);
        console.log(
          `Started new journey with conversation ID: ${conversationId}`
        );
      }

      // Get conversation history
      const conversationHistory =
        this.conversationHistories.get(journeyData.conversationId) || [];

      // Check if we need to provide hospital recommendations
      const hospitalData = await this.checkAndFetchHospitalData(
        query,
        conversationHistory
      );

      // Save incoming message to history FIRST (before generating response)
      conversationHistory.push({
        communicationMode: options.communicationMode || "WHATSAPP",
        incommingMessage: query,
        timestamp: new Date().toISOString(),
      });

      // Update conversation history immediately
      this.conversationHistories.set(
        journeyData.conversationId,
        conversationHistory
      );

      // Build the context for Gemini AFTER updating history
      const contextPayload = {
        intent: intentName,
        customerId: customerId,
        status: journeyData.status,
        customerContextHistory: conversationHistory,
        newIncommingMessage: {
          communicationMode: options.communicationMode || "WHATSAPP",
          incommingMessage: query,
        },
        brand_voice: intentConfig.brand_voice,
        business_goals: intentConfig.business_goals,
        recomendedAction: intentConfig.recomendedAction,
        hospitalData: hospitalData, // Include hospital data if available
        policyInfo: this.policyInfo, // Include policy information for personalization
      };

      console.log(
        "Sending context to Gemini:",
        JSON.stringify(contextPayload, null, 2)
      );

      // Generate response from Gemini
      const geminiResponse = await this.generateIntentResponse(
        contextPayload,
        customerId
      );

      // Check if this is a duplicate of the last sent message
      const lastSentMessage = conversationHistory
        .filter((msg) => msg.sentMessage)
        .pop()?.sentMessage;

      if (lastSentMessage && lastSentMessage.trim() === geminiResponse.trim()) {
        console.log("🚫 Duplicate message detected - skipping WhatsApp send");
        return {
          answer: geminiResponse,
          conversationId: journeyData.conversationId,
          intent: intentName,
          conversationHistory: conversationHistory,
          confidence: 1.0,
          queryType: "intent_journey",
          scheduledFollowUps: false,
          duplicateSkipped: true,
        };
      }

      // Save sent message to history
      conversationHistory.push({
        communicationMode: options.communicationMode || "WHATSAPP",
        sentMessage: geminiResponse,
        timestamp: new Date().toISOString(),
      });

      // Update conversation history with sent message
      this.conversationHistories.set(
        journeyData.conversationId,
        conversationHistory
      );

      // Update journey timestamp
      journeyData.updatedAt = new Date().toISOString();
      this.customerJourneys.set(customerId, journeyData);

      // Send message via WhatsApp asynchronously (fire and forget)
      console.log(
        "Sending message via WhatsApp communication service (non-blocking)..."
      );

      // Convert escaped newlines to actual newlines for WhatsApp
      const whatsappMessage = geminiResponse.replace(/\\n/g, "\n");

      console.log("TEXT TO SEND VIA WHATSAPP:", whatsappMessage);
      if (query == "Hospital locator journey viewed") {
        this.communicationService
          .sendMessage(whatsappMessage)
          .then((sendResult) => {
            console.log(
              "WhatsApp message send result:",
              sendResult.success ? "Success" : "Failed"
            );
          })
          .catch((error) => {
            console.error("Error sending WhatsApp message:", error);
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
        queryType: "intent_journey",
        scheduledFollowUps: schedulingResult.scheduled || false,
      };
    } catch (error) {
      console.error("Error processing intent journey:", error);
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
      console.error("Error generating intent response:", error);
      throw error;
    }
  }

  /**
   * Build system prompt for Gemini based on intent context
   * @param {Object} contextPayload - Context payload
   * @returns {string} - System prompt
   */
  buildSystemPrompt(contextPayload) {
    const {
      brand_voice,
      business_goals,
      recomendedAction,
      customerContextHistory,
      policyInfo,
      hospitalData,
    } = contextPayload;

    let prompt = `You are a ${brand_voice.persona} for an insurance company. Your communication should be ${brand_voice.tone} with a ${brand_voice.style} approach.\n\n`;

    prompt += `**Your Role:**\n`;
    prompt += `- Be a PROACTIVE CONCIERGE who TAKES ACTION on behalf of customers\n`;
    prompt += `- Write naturally and conversationally, like a caring professional\n`;
    prompt += `- Be warm, empathetic, and genuinely helpful\n`;
    prompt += `- Use 1-2 emojis maximum per message, only where meaningful\n`;
    prompt += `- DO THINGS FOR THEM - never ask them to check or do things themselves\n\n`;

    prompt += `**WhatsApp Formatting:**\n`;
    prompt += `- Use *bold* for important info (names, hospitals, dates)\n`;
    prompt += `- Use \\n\\n for paragraph breaks, \\n for line breaks\n`;
    prompt += `- Keep sentences short and mobile-friendly\n`;
    prompt += `- Break long text into clear sections with line breaks\n\n`;

    // Include policy information for personalization
    if (policyInfo) {
      const firstName = policyInfo.policyholder.split(" ")[0];
      prompt += `**Customer Info:**\n`;
      prompt += `Name: ${firstName} (${policyInfo.plan} member)\n`;
      if (policyInfo.insuredMembers && policyInfo.insuredMembers.length > 0) {
        prompt += `Family: `;
        policyInfo.insuredMembers.forEach((member, index) => {
          prompt += `${member.name.split(" ")[0]} (${member.relationship})`;
          if (index < policyInfo.insuredMembers.length - 1) prompt += `, `;
        });
        prompt += `\n`;
      }
      prompt += `- Use first names only\n`;
      prompt += `- When customer says "my wife/son/daughter", use their actual name from family list above\n\n`;
    }

    // Check conversation state
    const hasAISentMessage = customerContextHistory?.some(
      (msg) => msg.sentMessage
    );
    const hasAskedForCostAndDate = customerContextHistory?.some(
      (msg) =>
        msg.sentMessage &&
        msg.sentMessage.toLowerCase().includes("estimated cost")
    );

    // Check if customer has provided BOTH cost AND date/time
    const hasProvidedCost = customerContextHistory?.some(
      (msg) =>
        msg.incommingMessage &&
        (msg.incommingMessage.toLowerCase().includes("cost") ||
          msg.incommingMessage.toLowerCase().includes("₹") ||
          msg.incommingMessage.match(/\d{4,}/)) // 4+ digit number likely a cost
    );
    const hasProvidedDateTime = customerContextHistory?.some(
      (msg) =>
        msg.incommingMessage &&
        (msg.incommingMessage
          .toLowerCase()
          .match(
            /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/
          ) ||
          msg.incommingMessage
            .toLowerCase()
            .match(
              /(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/
            ) ||
          msg.incommingMessage.match(/\d{1,2}[:\s]?\d{2}/) || // Time like "08:00" or "8 00"
          msg.incommingMessage.match(/\d{1,2}[-\/]\d{1,2}/)) // Date like "20-10" or "20/10"
    );
    const hasProvidedBothCostAndDate = hasProvidedCost && hasProvidedDateTime;

    const hasShownHospitals = customerContextHistory?.some(
      (msg) =>
        msg.sentMessage &&
        msg.sentMessage.includes("Hospital") &&
        msg.sentMessage.includes("1.")
    );

    // Debug logging
    console.log("📊 Cost/Date Status:", {
      hasAskedForCostAndDate,
      hasProvidedCost,
      hasProvidedDateTime,
      hasProvidedBothCostAndDate,
    });

    if (customerContextHistory && customerContextHistory.length > 0) {
      prompt += `**Conversation History:**\n`;
      customerContextHistory.forEach((message) => {
        if (message.incommingMessage) {
          prompt += `Customer: ${message.incommingMessage}\n`;
        } else if (message.sentMessage) {
          prompt += `You: ${message.sentMessage}\n`;
        }
      });
      prompt += `\n**Rules:**\n`;
      prompt += `- DON'T repeat questions already answered above\n`;
      prompt += `- DON'T greet again (only greet in first message)\n`;
      prompt += `- Use info from history (who, what, where mentioned)\n`;
      if (hasAskedForCostAndDate && !hasProvidedBothCostAndDate) {
        if (hasProvidedCost && !hasProvidedDateTime) {
          prompt += `- Customer provided cost (${
            customerContextHistory.find(
              (m) => m.incommingMessage && m.incommingMessage.match(/\d{4,}/)
            )?.incommingMessage
          }). Only ask for DATE/TIME, DON'T ask for cost again!\n`;
        } else if (hasProvidedDateTime && !hasProvidedCost) {
          prompt += `- Customer provided date/time. Only ask for COST, DON'T ask for date/time again!\n`;
        } else {
          prompt += `- You already asked for cost/date - wait for response\n`;
        }
      } else if (hasProvidedBothCostAndDate) {
        prompt += `- Customer has provided BOTH cost and date/time. Move to next step (coordinate admission). DON'T ask for cost or date again!\n`;
      }
      prompt += `\n`;
    } else if (!hasAISentMessage) {
      prompt += `**First Message:**\n`;
      prompt += `- Greet warmly with "Hi [FirstName]"\n`;
      prompt += `- Ask what they need help with\n\n`;
    }

    prompt += `**Flow:** Greet → Who needs care → Medical reason → Show hospitals → Ask about admission → Get cost/date → Coordinate admission\n\n`;

    prompt += `**Key Instructions:**\n`;
    recomendedAction.forEach((action, index) => {
      prompt += `${index + 1}. ${action}\n`;
    });
    prompt += `\n`;

    prompt += `**Critical Rules:**\n`;
    prompt += `✅ DO: Take action for customer ("I'll coordinate..."), use their own words from history, ask about ADMISSION (not appointments) when hospital selected, ask for cost+date when admission confirmed\n`;
    prompt += `❌ DON'T: Repeat questions, repeat greetings, use templates/placeholders, ask customer to do things themselves, skip cost/date question after admission\n\n`;

    prompt += `**Examples:**\n`;
    if (policyInfo) {
      const firstName = policyInfo.policyholder.split(" ")[0];
      const spouse = policyInfo.insuredMembers?.find(
        (m) => m.relationship === "Spouse"
      );
      const spouseFirstName = spouse ? spouse.name.split(" ")[0] : "Punita";

      prompt += `First message: "Hi ${firstName} 👋\\n\\nI see you're looking for hospitals. I hope everything is okay.\\n\\nAre you looking for admission for yourself or a family member?"\n`;
      prompt += `After "my wife": "I understand *${spouseFirstName}* needs care. What's the medical reason?"\n`;
      prompt += `After hospital selection: "Do you seek admission or hospitalization in the hospital?"\n`;
      prompt += `After "yes to admission": "Please provide:\\n- *Estimated cost*\\n- *Date and time*"\n`;
      prompt += `If customer provides only cost: "Noted. Now please provide *date and time*" (DON'T ask for cost again!)\n`;
      prompt += `If customer provides only date/time: "Noted. Now please provide *estimated cost*" (DON'T ask for date again!)\n`;
      prompt += `After BOTH provided: "Ok noted I'll coordinate with the hospital for your admission on *[date/time]*"\n`;
      prompt += `NO greetings in follow-up messages - jump straight to content\n\n`;
    }

    // Include hospital data if available
    if (
      contextPayload.hospitalData &&
      contextPayload.hospitalData.hospitals &&
      contextPayload.hospitalData.hospitals.length > 0
    ) {
      prompt += `**Hospitals Available (${contextPayload.hospitalData.department}, ${contextPayload.hospitalData.location}):**\n`;
      prompt += `ALL covered by Tata AIG for cashless treatment ✅\n\n`;
      contextPayload.hospitalData.hospitals.forEach((hospital, index) => {
        prompt += `${index + 1}. *${hospital.hospitalName}*\n   ${
          hospital.hospitalAddress
        }, ${hospital.city}\n`;
      });
      prompt += `\nPresent these clearly with *bold* names, \\n breaks, and warm tone.\n\n`;
    }

    prompt += `Respond naturally with proper WhatsApp formatting (\\n breaks, *bold*):`;

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
      const hospitalKeywords = [
        "hospital",
        "hospitals",
        "admission",
        "treatment",
        "doctor",
        "medical",
        "surgery",
        "specialist",
      ];
      const needsHospitals = hospitalKeywords.some((keyword) =>
        query.toLowerCase().includes(keyword)
      );

      // Also check conversation history for medical conditions or requests
      const fullConversation = conversationHistory
        .map((msg) => msg.incommingMessage || msg.sentMessage || "")
        .join(" ")
        .toLowerCase();

      const hasMedicalContext =
        fullConversation.includes("hospital") ||
        fullConversation.includes("admission") ||
        fullConversation.includes("treatment");

      if (!needsHospitals && !hasMedicalContext) {
        return null;
      }

      // Extract department and location from query and history
      const extractionResult = await this.extractDepartmentAndLocation(
        query,
        conversationHistory
      );

      if (!extractionResult.department) {
        // If no department identified yet, return null (will ask customer for more info)
        return null;
      }

      console.log(
        `Searching hospitals for department: ${extractionResult.department}, location: ${extractionResult.location}`
      );

      // Search hospitals by department
      const hospitals = await this.searchHospitalsByDepartment(
        extractionResult.department,
        extractionResult.location
      );

      if (hospitals && hospitals.length > 0) {
        return {
          department: extractionResult.department,
          location: extractionResult.location,
          hospitals: hospitals.slice(0, 5), // Top 5 hospitals
        };
      }

      return null;
    } catch (error) {
      console.error("Error checking/fetching hospital data:", error);
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
      const fullConversation =
        conversationHistory
          .map((msg) => msg.incommingMessage || msg.sentMessage || "")
          .join("\n") +
        "\n" +
        query;

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
        contents: [{ role: "user", parts: [{ text: extractionPrompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 200,
        },
      });

      const responseText = response.response.text().trim();
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const extracted = JSON.parse(jsonMatch[0]);
        return {
          department: extracted.department,
          location: extracted.location || "Mumbai", // Default to Mumbai
        };
      }

      return { department: null, location: "Mumbai" };
    } catch (error) {
      console.error("Error extracting department and location:", error);
      return { department: null, location: "Mumbai" };
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
        console.warn("Hospital service not available");
        return [];
      }

      // Load hospital data
      const hospitalsPath = path.join(
        __dirname,
        "../../data/HospitalData.json"
      );
      const allHospitals = JSON.parse(fs.readFileSync(hospitalsPath, "utf8"));

      // Filter hospitals by department
      const matchingHospitals = allHospitals.filter((hospital) => {
        if (!hospital.departments || !Array.isArray(hospital.departments)) {
          return false;
        }
        // Case-insensitive match for department
        return hospital.departments.some(
          (dept) =>
            dept.toLowerCase().includes(department.toLowerCase()) ||
            department.toLowerCase().includes(dept.toLowerCase())
        );
      });

      // If location specified (and not just Mumbai), filter by location
      if (location && location.toLowerCase() !== "mumbai") {
        const locationFiltered = matchingHospitals.filter((hospital) => {
          const address = (hospital.hospitalAddress || "").toLowerCase();
          const city = (hospital.city || "").toLowerCase();
          const locationLower = location.toLowerCase();
          return (
            address.includes(locationLower) || city.includes(locationLower)
          );
        });

        // If we found location matches, use them; otherwise use all matching
        if (locationFiltered.length > 0) {
          return locationFiltered.slice(0, 5);
        }
      }

      // Return top 5 hospitals
      return matchingHospitals.slice(0, 5);
    } catch (error) {
      console.error("Error searching hospitals by department:", error);
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
  async initiateClaimForAdmission(
    conversationId,
    customerId,
    response,
    scheduledMessages = []
  ) {
    try {
      console.log("🏥 Initiating claim for hospital admission...");

      // Get conversation history to extract information
      const conversationHistory =
        this.conversationHistories.get(conversationId) || [];
      const fullConversation =
        conversationHistory
          .map((msg) => msg.incommingMessage || msg.sentMessage || "")
          .join("\n") +
        "\n" +
        response;

      // Extract hospital name from customer's most recent selection in conversation history
      let hospitalName = null;

      // First, try to find hospital name in customer's incoming messages (most recent first)
      const reversedHistory = [...conversationHistory].reverse();
      for (const msg of reversedHistory) {
        if (msg.incommingMessage) {
          // Check if customer mentioned a hospital name
          const customerMessage = msg.incommingMessage.toLowerCase();

          // Load hospitals to check against
          const hospitalsPath = path.join(
            __dirname,
            "../../data/HospitalData.json"
          );
          const allHospitals = JSON.parse(
            fs.readFileSync(hospitalsPath, "utf8")
          );

          // Find if any hospital name is mentioned in the customer's message
          // Prioritize unique identifiers over common words like "hospital", "centre", etc.
          for (const hospital of allHospitals) {
            const hospName = hospital.hospitalName.toLowerCase();

            // Split into words and filter out common terms
            const commonWords = [
              "hospital",
              "centre",
              "center",
              "multispeciality",
              "multi-speciality",
              "speciality",
              "specialty",
              "research",
              "healthcare",
              "managed",
              "care",
            ];
            const hospWords = hospName
              .split(/[\s()&,]+/)
              .filter((w) => w.length > 3 && !commonWords.includes(w));

            // Check if customer mentioned any unique identifier from this hospital
            if (
              hospWords.length > 0 &&
              hospWords.some((word) => customerMessage.includes(word))
            ) {
              hospitalName = hospital.hospitalName;
              console.log(
                "✅ Found hospital from customer message:",
                hospitalName
              );
              console.log(
                "   Matched on unique identifier:",
                hospWords.find((w) => customerMessage.includes(w))
              );
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
        console.log("⚠️ Extracted hospital from AI response:", hospitalName);
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
            /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/,
          ];

          for (const pattern of datePatterns) {
            const match = msg.incommingMessage.match(pattern);
            if (match) {
              dateString = match[0];
              console.log("✅ Found date from customer message:", dateString);
              break;
            }
          }

          if (dateString) break;
        }
      }

      // Fallback: Extract from AI response if not found in customer messages
      if (!dateString) {
        const dateMatch = response.match(
          /\*([^*]*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|[0-9]{1,2}[/-][0-9]{1,2})[^*]*)\*/
        );
        if (dateMatch) {
          dateString = dateMatch[1];
          console.log("⚠️ Extracted date from AI response:", dateString);
        }
      }

      // Parse the date string to DD-MM-YYYY format
      if (dateString) {
        dateOfAdmission = this.parseDateForClaim(dateString);
        console.log("📅 Final date of admission:", dateOfAdmission);
      }

      // Extract diagnosis/medical issue from conversation
      const diagnosis = await this.extractDiagnosisFromConversation(
        fullConversation
      );

      // Find selected hospital data
      let selectedHospital = null;
      if (hospitalName) {
        console.log("🔍 Searching for hospital:", hospitalName);
        const hospitalsPath = path.join(
          __dirname,
          "../../data/HospitalData.json"
        );
        const allHospitals = JSON.parse(fs.readFileSync(hospitalsPath, "utf8"));

        // Try multiple matching strategies
        selectedHospital = allHospitals.find((h) => {
          const dbName = h.hospitalName.toLowerCase();
          const searchName = hospitalName.toLowerCase();

          // Exact match
          if (dbName === searchName) return true;

          // Contains match (both directions)
          if (dbName.includes(searchName) || searchName.includes(dbName))
            return true;

          // Partial word match (split by spaces)
          const searchWords = searchName.split(" ").filter((w) => w.length > 2);
          const dbWords = dbName.split(" ").filter((w) => w.length > 2);

          return searchWords.some((word) =>
            dbWords.some(
              (dbWord) => dbWord.includes(word) || word.includes(dbWord)
            )
          );
        });

        console.log(
          "🔍 Hospital search result:",
          selectedHospital ? selectedHospital.hospitalName : "NOT FOUND"
        );

        // If still not found, try a more flexible search
        if (!selectedHospital) {
          console.log("🔍 Trying flexible search...");
          const searchWords = hospitalName
            .toLowerCase()
            .split(" ")
            .filter((w) => w.length > 2);
          selectedHospital = allHospitals.find((h) => {
            const dbName = h.hospitalName.toLowerCase();
            return searchWords.some((word) => dbName.includes(word));
          });
          console.log(
            "🔍 Flexible search result:",
            selectedHospital ? selectedHospital.hospitalName : "STILL NOT FOUND"
          );
        }
      }

      // Find which family member needs admission
      let memberRelation = "Self";
      const conversationLower = fullConversation.toLowerCase();
      if (
        conversationLower.includes("my wife") ||
        conversationLower.includes("wife")
      ) {
        memberRelation = "Spouse";
      } else if (conversationLower.includes("my son")) {
        memberRelation = "Son";
      } else if (conversationLower.includes("my daughter")) {
        memberRelation = "Daughter";
      }

      // Build claim data
      const userInputs = {
        dateOfAdmission: dateOfAdmission || this.getTodayDate(),
        diagnosis: diagnosis || "Medical treatment",
        estimatedCost: "50000", // Default estimate
        memberRelation: memberRelation,
        mobileNumber: "9830323302", // From customer ID or policy
        emailId: "customer@tataaig.com",
        communicationAddress: "6TH FLOOR, UNITECH CYBER PARK TOWER-C",
        communicationCity: "Mumbai",
        communicationPincode: "400001",
        memberGender: memberRelation === "Spouse" ? "Female" : "Male",
      };

      const hospitalData = selectedHospital
        ? {
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
            hospitalCountry: "INDIA",
          }
        : null;

      if (!hospitalData) {
        console.log("⚠️ Hospital data not found - cannot initiate claim");
        return { success: false, message: "Hospital not found" };
      }

      // Build and initiate claim
      const claimData = this.claimInitiationService.buildClaimData(
        this.policyInfo,
        userInputs,
        hospitalData
      );

      console.log("Initiating claim with data:", {
        hospital: hospitalData.hospitalName,
        member: memberRelation,
        date: userInputs.dateOfAdmission,
        diagnosis: userInputs.diagnosis,
      });

      // Initiate claim asynchronously (fire and forget)
      const customerName = this.policyInfo
        ? this.policyInfo.policyholder.split(" ")[0]
        : "there";
      const familyMemberName =
        memberRelation !== "Self" && this.policyInfo
          ? this.policyInfo.insuredMembers
              ?.find((m) => m.relationship === memberRelation)
              ?.name.split(" ")[0]
          : null;

      this.claimInitiationService
        .initiateClaim(claimData)
        .then((result) => {
          if (result.success && result.data && result.data.data) {
            console.log("✅ Claim initiated successfully!", result.data);

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

            console.log("Sending claim confirmation via WhatsApp...");
            this.communicationService
              .sendMessage(notificationMessage)
              .then(() => {
                console.log("✅ Claim confirmation sent via WhatsApp");

                // NOW SCHEDULE FOLLOW-UP MESSAGES AFTER INTIMATION ID IS SENT
                if (scheduledMessages && scheduledMessages.length > 0) {
                  console.log(
                    `📅 Scheduling ${scheduledMessages.length} follow-up messages now that intimation ID is confirmed`
                  );

                  // Update context with actual intimation ID and request ID
                  const updatedMessages = scheduledMessages.map((msg) => ({
                    ...msg,
                    text: msg.text
                      .replace(/{{claim Number}}/g, intimationId)
                      .replace(/{{intimationId}}/g, intimationId)
                      .replace(/{{requestId}}/g, requestId),
                  }));

                  this.schedulingAgent.scheduleMessages(
                    conversationId,
                    customerId,
                    updatedMessages
                  );

                  console.log("✅ Follow-up messages scheduled successfully");
                }
              })
              .catch((err) =>
                console.error("Error sending claim confirmation:", err)
              );
          } else {
            console.log("❌ Claim initiation failed:", result.error);
            console.log(
              "⚠️ Skipping scheduled messages due to claim initiation failure"
            );
          }
        })
        .catch((error) => {
          console.error("Error in claim initiation:", error);
          console.log(
            "⚠️ Skipping scheduled messages due to claim initiation error"
          );
        });

      // Return immediately without waiting
      return { success: true, message: "Claim initiation in progress" };
    } catch (error) {
      console.error("Error initiating claim for admission:", error);
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
  buildClaimConfirmationMessage(
    customerName,
    familyMemberName,
    intimationId,
    requestId,
    hospitalName
  ) {
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
        jan: 0,
        january: 0,
        feb: 1,
        february: 1,
        mar: 2,
        march: 2,
        apr: 3,
        april: 3,
        may: 4,
        jun: 5,
        june: 5,
        jul: 6,
        july: 6,
        aug: 7,
        august: 7,
        sep: 8,
        september: 8,
        oct: 9,
        october: 9,
        nov: 10,
        november: 10,
        dec: 11,
        december: 11,
      };

      // Try to parse "16 oct" or "16 october" format
      const monthMatch = dateLower.match(
        /(\d{1,2})\s*(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october|nov|november|dec|december)/i
      );
      if (monthMatch) {
        const day = parseInt(monthMatch[1]);
        const monthStr = dateLower.match(
          /(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october|nov|november|dec|december)/i
        )[0];
        const month = monthNames[monthStr];

        const targetDate = new Date(today.getFullYear(), month, day);

        // If the date is in the past, assume next year
        if (targetDate < today) {
          targetDate.setFullYear(today.getFullYear() + 1);
        }

        const dayStr = String(targetDate.getDate()).padStart(2, "0");
        const monthStr2 = String(targetDate.getMonth() + 1).padStart(2, "0");
        const year = targetDate.getFullYear();

        return `${dayStr}-${monthStr2}-${year}`;
      }

      // Map day names to dates
      const dayNames = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ];
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
      const day = String(targetDate.getDate()).padStart(2, "0");
      const month = String(targetDate.getMonth() + 1).padStart(2, "0");
      const year = targetDate.getFullYear();

      return `${day}-${month}-${year}`;
    } catch (error) {
      console.error("Error parsing date:", error);
      return this.getTodayDate();
    }
  }

  /**
   * Get today's date in DD-MM-YYYY format
   * @returns {string} - Today's date
   */
  getTodayDate() {
    const today = new Date();
    const day = String(today.getDate()).padStart(2, "0");
    const month = String(today.getMonth() + 1).padStart(2, "0");
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
        contents: [{ role: "user", parts: [{ text: extractionPrompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 50,
        },
      });

      const diagnosis = response.response.text().trim();
      return diagnosis || "Medical treatment";
    } catch (error) {
      console.error("Error extracting diagnosis:", error);
      return "Medical treatment";
    }
  }

  /**
   * @deprecated This method is part of the LEGACY flow and is NO LONGER USED.
   * The Orchestrator architecture handles claim initiation and scheduling deterministically
   * based on conversation stages, not pattern matching.
   *
   * See: processIntentJourneyWithOrchestrator() for the new approach
   *
   * Detect if follow-up messages should be scheduled based on the response
   * @param {string} response - AI response text
   * @param {string} conversationId - Conversation ID
   * @param {string} customerId - Customer ID
   * @param {string} intentName - Intent name
   * @param {string} query - Customer query
   * @returns {Promise<Object>} - Scheduling result
   */
  async detectAndScheduleFollowUps(
    response,
    conversationId,
    customerId,
    intentName,
    query
  ) {
    try {
      // Get intent configuration
      const intentConfig = this.getIntentConfig(intentName);
      if (!intentConfig || !intentConfig.recomendedAction) {
        return { scheduled: false, message: "No intent config found" };
      }

      // IMPORTANT: Check if AI agent is taking CONFIRMED action (not just offering)
      // Distinguish between different types of scheduling
      const responseLower = response.toLowerCase();

      // Check if this is about tele-consultation (should NOT trigger hospital admission follow-ups)
      const isTeleConsultation =
        responseLower.includes("tele-consultation") ||
        responseLower.includes("teleconsultation") ||
        responseLower.includes("follow-up consultation") ||
        responseLower.includes("consultation with") ||
        responseLower.includes("doctor will call");

      if (isTeleConsultation) {
        console.log(
          "This is a tele-consultation scheduling - NOT hospital admission. Skipping admission follow-ups."
        );
        return {
          scheduled: false,
          message: "Tele-consultation - different flow",
        };
      }

      // Check for HOSPITAL ADMISSION coordination (very specific)
      const isHospitalAdmission =
        (((responseLower.includes("coordinate") ||
          responseLower.includes("arrange") ||
          responseLower.includes("help you with admission") ||
          responseLower.includes("assist with admission") ||
          responseLower.includes("support your admission") ||
          responseLower.includes("organize admission") ||
          responseLower.includes("make admission arrangements")) &&
          responseLower.includes("admission at")) ||
          responseLower.includes("admission for") ||
          responseLower.includes("admission to") ||
          responseLower.includes("admission as soon") ||
          responseLower.includes("hospital admission") ||
          responseLower.includes("get you admitted") ||
          responseLower.includes("help you get admitted") ||
          responseLower.includes("arrange your admission") ||
          responseLower.includes("i'll send you a confirmation") ||
          responseLower.includes("i will send you a confirmation") ||
          responseLower.includes("i'll be in touch") ||
          responseLower.includes("i will be in touch") ||
          responseLower.includes("i'll coordinate") ||
          responseLower.includes("i will coordinate") ||
          responseLower.includes("i'll arrange your admission") ||
          responseLower.includes("we will arrange your admission") ||
          responseLower.includes("we will coordinate your admission") ||
          responseLower.includes("we will help you with hospital admission") ||
          responseLower.includes("we’ll help you with admission") ||
          responseLower.includes("will confirm your admission") ||
          responseLower.includes("will reach out to confirm admission") ||
          responseLower.includes("our team will contact you for admission") ||
          responseLower.includes("hospital team will connect") ||
          responseLower.includes("you’ll get a call for admission") ||
          responseLower.includes(
            "we will contact you shortly for admission"
          )) &&
        !responseLower.includes("consultation");

      // Check if CUSTOMER has selected a specific hospital in their recent messages
      const conversationHistory =
        this.conversationHistories.get(conversationId) || [];
      let customerSelectedHospital = false;

      // Load actual hospital data dynamically
      const hospitalsPath = path.join(
        __dirname,
        "../../data/HospitalData.json"
      );
      const allHospitals = JSON.parse(fs.readFileSync(hospitalsPath, "utf8"));

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
            const commonWords = [
              "hospital",
              "centre",
              "center",
              "multispeciality",
              "multi-speciality",
              "speciality",
              "specialty",
              "research",
              "healthcare",
              "managed",
              "care",
            ];
            const hospWords = hospName
              .split(/[\s()&,]+/)
              .filter((w) => w.length > 3 && !commonWords.includes(w));

            // Check if customer mentioned any unique identifier from this hospital
            if (
              hospWords.length > 0 &&
              hospWords.some((word) => customerMessage.includes(word))
            ) {
              customerSelectedHospital = true;
              console.log(
                "✅ Customer selected hospital in message:",
                msg.incommingMessage
              );
              console.log("   Matched hospital:", hospital.hospitalName);
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
      const isActualAdmissionScheduled =
        isHospitalAdmission && customerSelectedHospital;

      if (!isActualAdmissionScheduled) {
        console.log(
          "Hospital admission not ready for scheduling yet. Conditions:",
          {
            isHospitalAdmission,
            customerSelectedHospital,
            isTeleConsultation,
          }
        );
        console.log(
          "Skipping scheduling - waiting for customer to select a specific hospital."
        );
        return {
          scheduled: false,
          message: "Waiting for customer hospital selection",
        };
      }

      console.log(
        "✅ AI is coordinating HOSPITAL ADMISSION with specific hospital - initiating claim"
      );

      // Extract scheduled messages from recommended actions (to be scheduled after claim initiation)
      const scheduledMessages = [];
      intentConfig.recomendedAction.forEach((action, index) => {
        // Check for "schedule messagae:" or "schedule message:" prefix (handling typo)
        if (
          action.toLowerCase().startsWith("schedule messagae:") ||
          action.toLowerCase().startsWith("schedule message:")
        ) {
          // Extract the message text (remove the prefix)
          let messageText = action.replace(/^schedule messagae:/i, "").trim();
          messageText = messageText.replace(/^schedule message:/i, "").trim();

          scheduledMessages.push({
            text: messageText,
            delayInSeconds: 10, // 10 seconds delay between each message
          });
        }
      });

      // If no scheduled messages found, return
      if (scheduledMessages.length === 0) {
        return { scheduled: false, message: "No scheduled messages in intent" };
      }

      // Check if messages have already been scheduled for this conversation
      const existingScheduled =
        this.schedulingAgent.getScheduledMessages(conversationId);
      if (existingScheduled && existingScheduled.length > 0) {
        console.log(
          "Messages already scheduled for this conversation - skipping duplicate scheduling"
        );
        return { scheduled: false, message: "Already scheduled" };
      }

      console.log(
        `Found ${scheduledMessages.length} scheduled messages - AI is taking action, scheduling now`
      );

      // Prepare context for placeholder replacement
      const customerName = this.policyInfo
        ? this.policyInfo.policyholder.split(" ")[0]
        : "there";

      // Extract date/time from response if mentioned
      const dateMatch = response.match(
        /\*([^*]*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|[0-9]{1,2}[/-][0-9]{1,2})[^*]*)\*/
      );
      const date = dateMatch ? dateMatch[1] : null;

      // Extract hospital name from conversation history if available (reuse conversationHistory from above)
      let hospitalName = null;
      conversationHistory.forEach((msg) => {
        const text = msg.incommingMessage || msg.sentMessage || "";
        const hospitalMatch = text.match(/\*([^*]*[Hh]ospital[^*]*)\*/);
        if (hospitalMatch) {
          hospitalName = hospitalMatch[1];
        }
      });

      const context = {
        customerName: customerName,
        "hospital name": hospitalName || "the hospital",
        "date and time": date || "your scheduled date",
        "claim Number": "4300002322", // Static for now
        "claim amount": "Rs 430067", // Static for now
      };

      // Replace placeholders in scheduled messages
      const processedMessages = scheduledMessages.map((msg) => ({
        ...msg,
        text: this.replacePlaceholdersInMessage(msg.text, context),
      }));

      // INITIATE CLAIM AND SCHEDULE MESSAGES AFTER SUCCESS
      // Pass processed messages to claim initiation - they'll be scheduled after intimation ID is generated
      await this.initiateClaimForAdmission(
        conversationId,
        customerId,
        response,
        processedMessages
      );

      return {
        scheduled: "pending",
        message: "Messages will be scheduled after claim initiation completes",
        messageCount: processedMessages.length,
      };
    } catch (error) {
      console.error("Error detecting/scheduling follow-ups:", error);
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
    Object.keys(context).forEach((key) => {
      const placeholder = `{{${key}}}`;
      if (result.includes(placeholder)) {
        result = result.replace(
          new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
          context[key]
        );
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
      journeyData.status = "closed";
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
      this.conversationStates.delete(journeyData.conversationId);
      this.customerJourneys.delete(customerId);
    }
  }

  /**
   * Get or initialize conversation state for orchestrator
   * @param {string} conversationId - Conversation ID
   * @returns {Object} - Conversation state
   */
  getConversationState(conversationId) {
    if (!this.conversationStates.has(conversationId)) {
      this.conversationStates.set(conversationId, {
        currentStageId: null,
        collectedData: {},
        stageHistory: [],
      });
    }
    return this.conversationStates.get(conversationId);
  }

  /**
   * Update conversation state
   * @param {string} conversationId - Conversation ID
   * @param {Object} updates - Updates to state
   */
  updateConversationState(conversationId, updates) {
    const state = this.getConversationState(conversationId);
    Object.assign(state, updates);
    this.conversationStates.set(conversationId, state);
  }

  /**
   * Process intent journey using orchestrator (New Architecture)
   * @param {string} customerId - Customer ID
   * @param {string} intentName - Intent name
   * @param {string} query - User query
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Response object
   */
  async processIntentJourneyWithOrchestrator(
    customerId,
    intentName,
    query,
    options = {}
  ) {
    try {
      console.log(
        `\n🎯 ORCHESTRATOR MODE: Processing intent journey for customer ${customerId}`
      );
      console.log(`Intent: ${intentName}, Query: "${query}"\n`);

      // Get orchestrator for this intent
      const orchestrator = this.orchestrators.get(intentName);
      if (!orchestrator) {
        console.log("⚠️ No orchestrator found - falling back to legacy mode");
        return this.processIntentJourneyLegacy(
          customerId,
          intentName,
          query,
          options
        );
      }

      // Get intent configuration
      const intentConfig = this.getIntentConfig(intentName);
      if (!intentConfig) {
        throw new Error(`Intent configuration not found for: ${intentName}`);
      }

      // Get or create conversation ID for this journey
      let journeyData = this.customerJourneys.get(customerId);
      if (!journeyData || journeyData.intent !== intentName) {
        const conversationId = uuidv4();
        journeyData = {
          conversationId,
          intent: intentName,
          customerId,
          status: "active",
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.customerJourneys.set(customerId, journeyData);
        this.conversationHistories.set(conversationId, []);
        console.log(
          `✅ Started new journey with conversation ID: ${conversationId}`
        );
      }

      const conversationId = journeyData.conversationId;
      const conversationHistory =
        this.conversationHistories.get(conversationId) || [];
      const conversationState = this.getConversationState(conversationId);

      // Get current stage from orchestrator
      const currentStage = orchestrator.getCurrentStage(conversationState);
      console.log(
        `📍 Current Stage: ${currentStage.name} (${currentStage.id})`
      );
      console.log(`📊 Collected Data:`, conversationState.collectedData);

      // Check if customer is responding to scheduled tele-consultation message
      if (
        conversationState.currentStageId === "end" &&
        this.isTeleconsultationResponse(query, conversationHistory)
      ) {
        console.log(
          `🔄 Customer responding to scheduled tele-consultation message, transitioning to teleconsultation_response stage`
        );
        conversationState.currentStageId = "teleconsultation_response";
        conversationState.collectedData.teleconsultationInterest =
          this.isPositiveResponse(query) ? "yes" : "no";
      }

      // Extract data from user message
      const extractedData = orchestrator.extractDataFromMessage(
        currentStage,
        query,
        conversationState.collectedData
      );
      console.log(`📥 Extracted Data:`, extractedData);

      // Update collected data
      Object.assign(conversationState.collectedData, extractedData);

      // Check if this is the first message BEFORE adding to history
      const isFirstMessage = conversationHistory.length === 0;

      // Save incoming message to history
      conversationHistory.push({
        communicationMode: options.communicationMode || "WHATSAPP",
        incommingMessage: query,
        timestamp: new Date().toISOString(),
      });
      this.conversationHistories.set(conversationId, conversationHistory);

      // Determine next stage
      let nextStageId = orchestrator.determineNextStage(
        currentStage,
        conversationState.collectedData,
        query
      );
      console.log(`➡️ Next Stage: ${nextStageId}`);

      // Check if we need to perform actions (like hospital search)
      // Execute actions when TRANSITIONING TO a stage, not when already in it
      let actionResult = null;
      if (
        nextStageId === "show_hospitals" &&
        !conversationState.collectedData.hospitalSearchResults
      ) {
        console.log(
          "🔍 Transitioning to show_hospitals - performing hospital search"
        );
        actionResult = await this.performHospitalSearch(
          conversationState.collectedData
        );
      } else if (
        currentStage.id === "show_hospitals" &&
        !conversationState.collectedData.hospitalSearchResults
      ) {
        console.log(
          "🔍 In show_hospitals stage without hospital data - performing search"
        );
        actionResult = await this.performHospitalSearch(
          conversationState.collectedData
        );
      }
      // Note: claim initiation is handled in the auto-execution loop below

      // Update state with action results
      if (actionResult) {
        Object.assign(conversationState.collectedData, actionResult);
      }

      // Build prompt based on current/next stage
      const geminiResponse = await this.generateOrchestratorResponse(
        currentStage,
        nextStageId,
        conversationState.collectedData,
        conversationHistory,
        intentConfig,
        orchestrator,
        customerId,
        isFirstMessage
      );

      // Save sent message to history
      conversationHistory.push({
        communicationMode: options.communicationMode || "WHATSAPP",
        sentMessage: geminiResponse,
        timestamp: new Date().toISOString(),
      });
      this.conversationHistories.set(conversationId, conversationHistory);

      // Update stage if transitioning
      if (nextStageId !== currentStage.id) {
        conversationState.stageHistory.push({
          stage: currentStage.id,
          timestamp: new Date().toISOString(),
        });
        conversationState.currentStageId = nextStageId;
        console.log(`🔄 Transitioned to stage: ${nextStageId}`);
      }

      this.updateConversationState(conversationId, conversationState);

      // Auto-progress through action stages (stages that don't need user input)
      let finalStageId = nextStageId;
      let finalResponse = geminiResponse;

      // Check if transitioning to initiate_claim - update the response to tell user we're processing
      if (nextStageId === "initiate_claim") {
        console.log(
          `🚀 All admission data collected. Initiating claim in background...`
        );
        // Override the response to tell user we're processing
        const firstName = this.policyInfo
          ? this.policyInfo.policyholder.split(" ")[0]
          : "there";
        finalResponse = `Thank you, ${firstName}. I have all the information I need.\n\nI will initiate the claim for admission and let you know once it's confirmed. This will just take a moment.`;

        // WhatsApp messages are only sent after claim initiation, not for every AI response
        console.log(
          "✅ Processing message ready (WhatsApp will be sent after claim initiation)"
        );

        // Execute claim initiation in the background (async, non-blocking)
        (async () => {
          try {
            console.log("🔄 Background: Starting claim initiation...");
            const actionResult = await this.performClaimInitiation(
              conversationState.collectedData,
              conversationHistory,
              conversationId,
              customerId
            );

            if (actionResult && actionResult.intimationId) {
              // Update conversation state with intimation ID
              conversationState.collectedData.intimationId =
                actionResult.intimationId;
              conversationState.collectedData.claimInitiated = true;
              conversationState.currentStageId = "end";
              this.updateConversationState(conversationId, conversationState);

              const firstName = this.policyInfo
                ? this.policyInfo.policyholder.split(" ")[0]
                : "there";
              const familyMember =
                conversationState.collectedData.patientRelation === "Self"
                  ? "your"
                  : this.policyInfo?.insuredMembers
                      ?.find(
                        (m) =>
                          m.relationship ===
                          conversationState.collectedData.patientRelation
                      )
                      ?.name.split(" ")[0] || "the patient";

              const confirmationMessage =
                `✅ Great news, ${firstName}!\n\n` +
                `Your claim has been successfully initiated for ${familyMember}'s admission at *${conversationState.collectedData.selectedHospital}* on *${conversationState.collectedData.admissionDate}*.\n\n` +
                `*Intimation ID:* ${actionResult.intimationId}\n\n` +
                `Please keep this ID handy. You'll need it at the hospital for cashless treatment.\n\n` +
                `Wishing you a smooth admission process and a speedy recovery! 🙏`;

              // Send WhatsApp message with intimation ID
              const whatsappConfirmation = confirmationMessage.replace(
                /\\n/g,
                "\n"
              );
              await this.communicationService.sendMessage(whatsappConfirmation);
              console.log(
                `✅ Background: Claim confirmation sent via WhatsApp with intimation ID: ${actionResult.intimationId}`
              );

              // Schedule follow-up messages
              console.log("🔄 Background: Checking for scheduled messages...");
              const scheduledMessages =
                intentConfig.recomendedAction?.filter(
                  (action) =>
                    action.toLowerCase().includes("schedule messagae:") ||
                    action.toLowerCase().includes("schedule message:")
                ) || [];

              if (scheduledMessages.length > 0) {
                console.log(
                  `📅 Background: Found ${scheduledMessages.length} messages to schedule`
                );

                // Prepare messages for scheduling
                const messagesToSchedule = scheduledMessages
                  .map((action, index) => {
                    // Extract the message after "schedule messagae:" or "schedule message:"
                    const messageMatch = action.match(
                      /schedule\s+messagae?:\s*(.+)/i
                    );
                    if (messageMatch) {
                      const scriptedMessage = messageMatch[1].trim();

                      return {
                        text: scriptedMessage,
                        delayInSeconds: 10, // 10 seconds for all messages (for testing)
                        order: index + 1,
                      };
                    }
                    return null;
                  })
                  .filter((msg) => msg !== null);

                // Schedule all messages at once via SchedulingAgent
                if (this.schedulingAgent && messagesToSchedule.length > 0) {
                  this.schedulingAgent.scheduleMessages(
                    conversationId,
                    customerId,
                    messagesToSchedule
                  );
                  console.log(
                    `📅 Background: Scheduled ${messagesToSchedule.length} follow-up messages`
                  );
                  messagesToSchedule.forEach((msg) => {
                    console.log(
                      `   - Message ${msg.order}: ${msg.delayInSeconds} seconds from now`
                    );
                  });
                }
              } else {
                console.log(
                  "ℹ️ Background: No scheduled messages found in recommendedAction"
                );
              }
            } else {
              console.error("❌ Background: Claim initiation failed");
              // Optionally send failure message to customer
            }
          } catch (error) {
            console.error("❌ Background: Error in claim initiation:", error);
          }
        })();

        // Mark stage as completed for state tracking
        conversationState.currentStageId = "end";
        finalStageId = "end";
      }

      // Send WhatsApp message (skip if already sent for claim initiation)
      if (query == "Hospital locator journey viewed") {
        const whatsappMessage = finalResponse.replace(/\\n/g, "\n");
        this.communicationService
          .sendMessage(whatsappMessage)
          .then((sendResult) => console.log("✅ WhatsApp message sent"))
          .catch((error) => console.error("❌ WhatsApp send error:", error));
      }

      // Return response
      return {
        answer: finalResponse,
        conversationId,
        intent: intentName,
        currentStage: finalStageId,
        collectedData: conversationState.collectedData,
        conversationHistory,
        orchestratorMode: true,
      };
    } catch (error) {
      console.error("Error processing orchestrated intent journey:", error);
      throw error;
    }
  }

  /**
   * Perform hospital search action (using AI to identify department)
   * @param {Object} collectedData - Collected data
   * @returns {Promise<Object>} - Hospital data
   */
  async performHospitalSearch(collectedData) {
    try {
      const { medicalReason, location } = collectedData;
      if (!medicalReason) return null;

      console.log(
        `🔍 Searching hospitals for: "${medicalReason}" in ${
          location || "Mumbai"
        }`
      );

      // Step 1: Use Gemini AI to identify the correct medical department
      console.log("🤖 Calling Gemini AI to identify medical department...");
      const targetDepartment = await this.identifyMedicalDepartment(
        medicalReason
      );
      console.log(`🎯 AI identified department: ${targetDepartment}`);

      // Step 2: Load hospital data
      const hospitalsPath = path.join(
        __dirname,
        "../../data/HospitalData.json"
      );
      const allHospitals = JSON.parse(fs.readFileSync(hospitalsPath, "utf8"));

      // Step 3: Filter hospitals by department
      let matchingHospitals = allHospitals.filter((hospital) => {
        if (!hospital.departments) return false;
        return hospital.departments.some(
          (dept) =>
            dept.toLowerCase().includes(targetDepartment.toLowerCase()) ||
            targetDepartment.toLowerCase().includes(dept.toLowerCase())
        );
      });

      console.log(
        `📊 Found ${matchingHospitals.length} hospitals with ${targetDepartment} department`
      );

      // Step 4: Filter by location if provided
      if (location) {
        const locationFiltered = matchingHospitals.filter(
          (hospital) =>
            hospital.city?.toLowerCase().includes(location.toLowerCase()) ||
            hospital.zone?.toLowerCase().includes(location.toLowerCase()) ||
            hospital.hospitalAddress
              ?.toLowerCase()
              .includes(location.toLowerCase())
        );
        if (locationFiltered.length > 0) {
          matchingHospitals = locationFiltered;
          console.log(
            `📍 Filtered to ${matchingHospitals.length} hospitals in ${location}`
          );
        }
      }

      // Step 5: Return top 5 hospitals
      const topHospitals = matchingHospitals.slice(0, 5);

      console.log(`✅ Returning top ${topHospitals.length} hospitals`);
      topHospitals.forEach((h, i) => {
        console.log(`   ${i + 1}. ${h.hospitalName} - ${h.zone}, ${h.city}`);
      });

      return {
        hospitalSearchResults: topHospitals,
        departmentSearched: targetDepartment,
      };
    } catch (error) {
      console.error("Error performing hospital search:", error);
      return null;
    }
  }

  /**
   * Use Gemini AI to identify the correct medical department from a medical reason
   * @param {string} medicalReason - Medical reason/condition described by user
   * @returns {Promise<string>} - Medical department name
   */
  async identifyMedicalDepartment(medicalReason) {
    try {
      const prompt = `You are a medical department classifier for a hospital system.

Available hospital departments:
- General Medicine
- Gastroenterology
- Neurosurgery
- Endocrinology
- Urology
- Nephrology
- Pulmonology
- Dermatology
- Hematology
- Rheumatology
- Vascular Surgery
- Neuro Medicine
- General Surgery
- ENT
- Orthopedics
- Obstetrics and Gynecology
- Oral and Maxillofacial Surgery
- Pediatrics
- Geriatrics
- Plastic Surgery
- Psychiatry
- Cardiology
- Oncology
- Ophthalmology
- Radiology
- Anesthesiology
- Emergency Medicine
- Intensive Care Unit (ICU)
- Pathology
- Microbiology

Medical condition/reason: "${medicalReason}"

Identify which ONE department from the list above would be most appropriate for treating this condition.
Respond with ONLY the department name, nothing else.

Examples:
- "kidney stone" → Urology
- "hand fracture" → Orthopedics
- "heart attack" → Cardiology
- "pregnancy" → Obstetrics and Gynecology
- "skin rash" → Dermatology
- "chest pain" → Cardiology
- "broken bone" → Orthopedics
- "diabetes" → Endocrinology
- "cancer" → Oncology
- "child fever" → Pediatrics

Department:`;

      const response = await this.geminiService.model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1, // Low temperature for consistent classification
          maxOutputTokens: 50,
        },
      });

      const department = response.response.text().trim();

      // Validate that the response is a valid department
      if (department && department.length > 0 && department.length < 100) {
        return department;
      } else {
        // Fallback to General Medicine if AI response is invalid
        console.warn(
          "Invalid department from AI, using General Medicine as fallback"
        );
        return "General Medicine";
      }
    } catch (error) {
      console.error("Error identifying medical department:", error);
      // Fallback to General Medicine
      return "General Medicine";
    }
  }

  /**
   * Perform claim initiation action (for orchestrator - waits for completion)
   * @param {Object} collectedData - Collected data
   * @param {Array} conversationHistory - Conversation history
   * @param {string} conversationId - Conversation ID
   * @param {string} customerId - Customer ID
   * @returns {Promise<Object>} - Claim data with intimation ID
   */
  async performClaimInitiation(
    collectedData,
    conversationHistory,
    conversationId,
    customerId
  ) {
    try {
      console.log("🏥 Orchestrator: Performing SYNCHRONOUS claim initiation");
      console.log("Collected Data:", JSON.stringify(collectedData, null, 2));

      // Extract patient info
      const patientRelation = collectedData.patientRelation || "Self";
      const familyMember = this.policyInfo?.insuredMembers?.find(
        (m) => m.relationship === patientRelation
      );
      const patientName = familyMember
        ? familyMember.name
        : this.policyInfo?.policyholder;

      // Find hospital data
      const hospitalsPath = path.join(
        __dirname,
        "../../data/HospitalData.json"
      );
      const allHospitals = JSON.parse(fs.readFileSync(hospitalsPath, "utf8"));

      // Prefer exact object captured at selection time to avoid mismatches
      let selectedHospital = collectedData.selectedHospitalDetails || null;
      if (!selectedHospital) {
        const hospitalName = collectedData.selectedHospital;
        selectedHospital = allHospitals.find((h) => {
          const dbName = h.hospitalName.toLowerCase();
          const searchName = hospitalName?.toLowerCase() || "";
          return dbName.includes(searchName) || searchName.includes(dbName);
        });
      }

      if (!selectedHospital) {
        console.error("❌ Hospital not found:", hospitalName);
        return { claimError: true, errorMessage: "Hospital not found" };
      }

      // Build user inputs
      const userInputs = {
        dateOfAdmission: this.parseDateForClaim(collectedData.admissionDate),
        diagnosis: collectedData.medicalReason || "Medical treatment",
        estimatedCost: collectedData.estimatedCost,
      };

      console.log("Hospital found:", selectedHospital.hospitalName);
      console.log("User inputs:", userInputs);

      // Build claim data
      const claimData = this.claimInitiationService.buildClaimData(
        this.policyInfo,
        userInputs,
        selectedHospital
      );

      // Initiate claim and WAIT for response
      console.log("📞 Calling claim initiation API...");
      const result = await this.claimInitiationService.initiateClaim(claimData);

      if (result.success && result.data && result.data.data) {
        const intimationId = result.data.data.intimationId;
        const requestId = result.data.data.requestId;

        console.log("✅ Claim initiated! Intimation ID:", intimationId);

        return {
          intimationId,
          requestId,
          claimInitiated: true,
          hospitalName: selectedHospital.hospitalName,
          patientName,
        };
      } else {
        console.error("❌ Claim initiation failed:", result.error);
        return {
          claimError: true,
          errorMessage: result.error || "Claim initiation failed",
        };
      }
    } catch (error) {
      console.error("❌ Error performing claim initiation:", error);
      return {
        claimError: true,
        errorMessage: error.message,
      };
    }
  }

  /**
   * Generate response using orchestrator logic
   * @param {Object} currentStage - Current stage
   * @param {string} nextStageId - Next stage ID
   * @param {Object} collectedData - Collected data
   * @param {Array} conversationHistory - Conversation history
   * @param {Object} intentConfig - Intent configuration
   * @param {Object} orchestrator - Orchestrator instance
   * @param {string} customerId - Customer ID
   * @returns {Promise<string>} - Generated response
   */
  async generateOrchestratorResponse(
    currentStage,
    nextStageId,
    collectedData,
    conversationHistory,
    intentConfig,
    orchestrator,
    customerId,
    isFirstMessage = false
  ) {
    // Handle 'teleconsultation_response' stage specially
    if (nextStageId === "teleconsultation_response") {
      const firstName = this.policyInfo
        ? this.policyInfo.policyholder.split(" ")[0]
        : "there";

      // Get the last scheduled message that customer is responding to
      const lastScheduledMessage =
        conversationHistory.filter((msg) => msg.sentMessage).slice(-1)[0]
          ?.sentMessage || "";

      let prompt = `You are a ${intentConfig.brand_voice.persona}. Be ${intentConfig.brand_voice.tone}.\n\n`;
      prompt += `Customer: ${firstName}\n\n`;
      prompt += `**CONTEXT:** The customer just responded to this scheduled message:\n`;
      prompt += `"${lastScheduledMessage}"\n\n`;
      prompt += `**CUSTOMER RESPONSE:** "${
        conversationHistory.filter((msg) => msg.incommingMessage).pop()
          ?.incommingMessage || ""
      }"\n\n`;
      prompt += `**TASK:** Handle their response to the tele-consultation offer.\n\n`;

      if (collectedData.teleconsultationInterest === "yes") {
        prompt += `**INSTRUCTIONS:** Customer said YES to tele-consultation. Ask for their preferred date and time for the consultation. Clarify this is a consultation, not admission.\n\n`;
        prompt += `**EXAMPLE RESPONSE:** "Great! I will schedule a follow-up tele consultation with your healthcare provider. Please let me know your preferred date and time for the consultation."\n\n`;
      } else {
        prompt += `**INSTRUCTIONS:** Customer said NO to tele-consultation. Thank them politely and close the conversation.\n\n`;
        prompt += `**EXAMPLE RESPONSE:** "No problem at all! If you need any assistance in the future, please feel free to reach out. Take care!"\n\n`;
      }

      prompt += `Respond naturally with proper WhatsApp formatting (*bold*, \\n breaks). Be warm and supportive.`;

      const latestUserMessage =
        conversationHistory.filter((msg) => msg.incommingMessage).pop()
          ?.incommingMessage || "";

      return await this.geminiService.generateIntentBasedResponse(
        prompt,
        latestUserMessage,
        customerId
      );
    }

    // Handle 'collect_consultation_preferences' stage specially
    if (nextStageId === "collect_consultation_preferences") {
      const firstName = this.policyInfo
        ? this.policyInfo.policyholder.split(" ")[0]
        : "there";

      let prompt = `You are a ${intentConfig.brand_voice.persona}. Be ${intentConfig.brand_voice.tone}.\n\n`;
      prompt += `Customer: ${firstName}\n\n`;
      prompt += `**CONTEXT:** Customer wants to schedule a tele-consultation with their healthcare provider.\n\n`;
      prompt += `**TASK:** Collect their preferred date and time for the tele-consultation.\n\n`;
      prompt += `**INSTRUCTIONS:** Ask for their preferred date and time for the consultation. Clarify this is a consultation, not admission.\n\n`;
      prompt += `**EXAMPLE RESPONSE:** "Great! I will schedule a follow-up tele consultation with your healthcare provider. Please let me know your preferred date and time for the consultation."\n\n`;
      prompt += `Respond naturally with proper WhatsApp formatting (*bold*, \\n breaks). Be warm and supportive.`;

      const latestUserMessage =
        conversationHistory.filter((msg) => msg.incommingMessage).pop()
          ?.incommingMessage || "";

      return await this.geminiService.generateIntentBasedResponse(
        prompt,
        latestUserMessage,
        customerId
      );
    }

    // Handle 'confirm_consultation' stage specially
    if (nextStageId === "confirm_consultation") {
      const firstName = this.policyInfo
        ? this.policyInfo.policyholder.split(" ")[0]
        : "there";

      let prompt = `You are a ${intentConfig.brand_voice.persona}. Be ${intentConfig.brand_voice.tone}.\n\n`;
      prompt += `Customer: ${firstName}\n\n`;
      prompt += `**CONTEXT:** Customer provided consultation preferences:\n`;
      prompt += `- Date: ${collectedData.consultationDate || "Not provided"}\n`;
      prompt += `- Time: ${
        collectedData.consultationTime || "Not provided"
      }\n\n`;
      prompt += `**TASK:** Confirm the tele-consultation appointment details.\n\n`;
      prompt += `**INSTRUCTIONS:** Confirm the tele-consultation appointment details and ask them to be available at the scheduled time.\n\n`;
      prompt += `**EXAMPLE RESPONSE:** "We have successfully scheduled your follow-up tele consultation with your healthcare provider on ${collectedData.consultationDate} at ${collectedData.consultationTime}. Please ensure you are available at that time for the consultation."\n\n`;
      prompt += `Respond naturally with proper WhatsApp formatting (*bold*, \\n breaks). Be warm and supportive.`;

      const latestUserMessage =
        conversationHistory.filter((msg) => msg.incommingMessage).pop()
          ?.incommingMessage || "";

      return await this.geminiService.generateIntentBasedResponse(
        prompt,
        latestUserMessage,
        customerId
      );
    }

    // Handle 'end' stage specially (conversation complete)
    if (nextStageId === "end") {
      // Generate a final confirmation message without stage-specific prompts
      const firstName = this.policyInfo
        ? this.policyInfo.policyholder.split(" ")[0]
        : "there";
      let prompt = `You are a ${intentConfig.brand_voice.persona}. Be ${intentConfig.brand_voice.tone}.\n\n`;
      prompt += `Customer: ${firstName}\n`;
      prompt += `\n**Task:** Provide final confirmation that everything is set up.\n`;
      prompt += `**Instructions:** Confirm admission with intimation ID ${collectedData.intimationId}, hospital ${collectedData.selectedHospital}, and date ${collectedData.admissionDate}. Wish them a speedy recovery.\n\n`;
      prompt += `Respond naturally with proper WhatsApp formatting (*bold*, \\n breaks). Be warm and supportive.`;

      const latestUserMessage =
        conversationHistory.filter((msg) => msg.incommingMessage).pop()
          ?.incommingMessage || "";

      return await this.geminiService.generateIntentBasedResponse(
        prompt,
        latestUserMessage,
        customerId
      );
    }

    // Build a concise, stage-specific prompt
    const nextStage = orchestrator.stages.get(nextStageId);
    if (!nextStage) {
      console.error(`❌ Stage not found: ${nextStageId}`);
      return `Thank you for your time. If you need any assistance, please reach out to us.`;
    }

    const stagePrompt = orchestrator.getStagePrompt(
      nextStage,
      collectedData,
      isFirstMessage
    );

    const firstName = this.policyInfo
      ? this.policyInfo.policyholder.split(" ")[0]
      : "there";

    let prompt = `You are a ${intentConfig.brand_voice.persona}. Be ${intentConfig.brand_voice.tone}.\n\n`;
    prompt += `Customer: ${firstName}\n`;

    if (this.policyInfo?.insuredMembers) {
      prompt += `Family: `;
      this.policyInfo.insuredMembers.forEach((m, i) => {
        prompt += `${m.name.split(" ")[0]} (${m.relationship})`;
        if (i < this.policyInfo.insuredMembers.length - 1) prompt += ", ";
      });
      prompt += `\n`;
    }

    prompt += `\n**Current Task:** ${nextStage.name}\n`;
    prompt += `**Instructions:** ${stagePrompt}\n`;

    // Add stage-specific critical instructions
    if (nextStageId === "confirm_admission") {
      prompt += `\n🚨 CRITICAL: You MUST ask the question that should mean: "Do you seek admission or hospitalization in the hospital?"\n`;
      prompt += `DO NOT assume the answer. DO NOT skip this question. ASK IT EXPLICITLY.\n`;
    } else if (nextStageId === "collect_admission_details") {
      const hasCost = !!collectedData.estimatedCost;
      const hasDate = !!collectedData.admissionDate;
      if (!hasCost && !hasDate) {
        prompt += `\n🚨 CRITICAL: You MUST ask for BOTH:\n`;
        prompt += `1. Estimated cost of treatment (in rupees)\n`;
        prompt += `2. Date and time of admission\n`;
        prompt += `DO NOT proceed without asking these. DO NOT assume you have this information.\n`;
      } else if (hasCost && !hasDate) {
        prompt += `\n🚨 CRITICAL: Cost is already provided (₹${collectedData.estimatedCost}).\n`;
        prompt += `You MUST ask ONLY for: Date and time of admission\n`;
        prompt += `DO NOT ask for cost again. DO NOT skip the date/time question.\n`;
      } else if (!hasCost && hasDate) {
        prompt += `\n🚨 CRITICAL: Date/time is already provided (${collectedData.admissionDate}).\n`;
        prompt += `You MUST ask ONLY for: Estimated cost of treatment\n`;
        prompt += `DO NOT ask for date/time again. DO NOT skip the cost question.\n`;
      }
    }
    prompt += `\n`;

    if (conversationHistory.length > 0) {
      prompt += `**Recent Conversation:**\n`;
      conversationHistory.slice(-4).forEach((msg) => {
        if (msg.incommingMessage)
          prompt += `Customer: ${msg.incommingMessage}\n`;
        else if (msg.sentMessage) prompt += `You: ${msg.sentMessage}\n`;
      });
      prompt += `\n`;
    }

    prompt += `**Collected Data:** ${JSON.stringify(
      collectedData,
      null,
      2
    )}\n\n`;

    // Add hospital data if showing hospitals
    if (
      nextStage.id === "show_hospitals" &&
      collectedData.hospitalSearchResults &&
      collectedData.hospitalSearchResults.length > 0
    ) {
      prompt += `**🏥 HOSPITALS TO SHOW (CRITICAL - USE ONLY THESE, DO NOT MAKE UP ANY OTHERS):**\n\n`;
      prompt += `Department: ${collectedData.departmentSearched}\n`;
      prompt += `All hospitals below are covered by Tata AIG for cashless treatment.\n\n`;

      collectedData.hospitalSearchResults.forEach((h, i) => {
        prompt += `${i + 1}. *${h.hospitalName}*\n`;
        prompt += `   Address: ${h.hospitalAddress}, ${h.city}\n`;
        prompt += `   Zone: ${h.zone}\n`;
        prompt += `   Pincode: ${h.pincode}\n`;
        if (h.departments && h.departments.length > 0) {
          const relevantDepts = h.departments.slice(0, 3).join(", ");
          prompt += `   Key Departments: ${relevantDepts}\n`;
        }
        prompt += `\n`;
      });

      prompt += `**CRITICAL INSTRUCTIONS:**\n`;
      prompt += `- Present EXACTLY these ${collectedData.hospitalSearchResults.length} hospitals listed above\n`;
      prompt += `- Use their EXACT names as shown\n`;
      prompt += `- DO NOT add, remove, or modify any hospital names\n`;
      prompt += `- DO NOT make up hospital names like "Apollo", "Fortis", etc. that are not in the list\n`;
      prompt += `- Format nicely for WhatsApp with proper line breaks\n\n`;
    }

    // Add constraints to prevent premature actions
    if (
      nextStageId === "confirm_admission" ||
      nextStageId === "collect_admission_details"
    ) {
      prompt += `\n⚠️ CONSTRAINTS:\n`;
      prompt += `- DO NOT say "I will initiate" or "I will process" anything yet\n`;
      prompt += `- DO NOT mention pre-authorization, claim filing, or coordination\n`;
      prompt += `- ONLY ask the required question(s) and wait for customer response\n`;
      prompt += `- Keep response short and focused on the question\n\n`;
    }

    prompt += `Respond naturally with proper WhatsApp formatting (*bold*, \\n breaks). Be concise.`;

    // Get latest user message for context
    const latestUserMessage =
      conversationHistory.filter((msg) => msg.incommingMessage).pop()
        ?.incommingMessage || "";

    // LOG THE PROMPT FOR DEBUGGING
    console.log("\n" + "=".repeat(80));
    console.log(`🤖 PROMPT FOR STAGE: ${nextStageId}`);
    console.log("=".repeat(80));
    console.log(prompt);
    console.log("=".repeat(80));
    console.log(`📨 User Message: "${latestUserMessage}"`);
    console.log("=".repeat(80) + "\n");

    // Generate response
    const response = await this.geminiService.generateIntentBasedResponse(
      prompt,
      latestUserMessage,
      customerId
    );

    console.log("\n" + "=".repeat(80));
    console.log("💬 GEMINI RESPONSE:");
    console.log("=".repeat(80));
    console.log(response);
    console.log("=".repeat(80) + "\n");

    return response;
  }

  /**
   * Check if response is positive (yes, ok, sure, etc.)
   * @param {string} message - User message
   * @returns {boolean}
   */
  isPositiveResponse(message) {
    const positiveWords = [
      "yes",
      "sure",
      "ok",
      "okay",
      "yep",
      "yeah",
      "i would like",
      "i want",
      "please",
      "absolutely",
      "definitely",
    ];
    const messageLower = message.toLowerCase();
    return positiveWords.some((word) => messageLower.includes(word));
  }

  /**
   * Check if customer is responding to scheduled tele-consultation message
   * @param {string} query - Current user query
   * @param {Array} conversationHistory - Conversation history
   * @returns {boolean}
   */
  isTeleconsultationResponse(query, conversationHistory) {
    // Check if conversation is in 'end' state and customer is responding
    const isEndState = true; // We're checking this when conversation is in 'end' state

    // Check if current query is a response (not a new question)
    const responseKeywords = [
      "yes",
      "no",
      "sure",
      "ok",
      "okay",
      "not interested",
      "decline",
      "i would like",
      "i want",
    ];
    const queryLower = query.toLowerCase();
    const isResponse = responseKeywords.some((keyword) =>
      queryLower.includes(keyword)
    );

    // For testing purposes, if customer says "yes" and conversation is in end state,
    // assume they're responding to tele-consultation offer
    if (isEndState && isResponse && queryLower.includes("yes")) {
      console.log(
        '🔄 Detected tele-consultation response: Customer said "yes" in end state'
      );
      return true;
    }

    return false;
  }
}

module.exports = IntentJourneyService;
