const axios = require('axios');

/**
 * Claim Initiation Service
 * Handles claim initiation API calls to Tata AIG
 */
class ClaimInitiationService {
  constructor(config = {}) {
    this.apiEndpoint = config.apiEndpoint || 'https://alpha10bn.tataaig.com/servicing/api/health/claims/initiate-claim';
    this.authToken = config.authToken || 'd3d42d2072b0f3c2cfbb518685f2283f:1f918c464782a6a3b3c3b1bf2522be5bc1999a2d239ac29a9ef9fee08dd390d999ce113f7126ff27eca15d03f08bef568e47c0e15263d6799385067d575bc361002df1deb1da139aa798319eee497cfc28c82fc248f3549b78d694b2cb37ec73256674262d1d6f6f0487d5f4941f9c88ceec6d398db1441f2a02ce81a65ba8ba1ec01117feb761bfa1824fbd410da2aab771d01a52d8610a0a753c859a48caff7fac8c3c9fd19a74b3bc590538ffdd9a5b905e34f8e07a0c5c01542b283033f586e6692df8f5a8212a53891fa83ac0b7b355d9e1569c60c86b7ff79c6b514f6716f79109b5fa258d8894158a55222019514d165adde03772e27575795ec317d4eab47dcc96896f3844449201df3ce96553df0068800489d786c5499b4896889337d53f4b260740c24e158739f54c3041db6d83c866f2eed746d46ac267685f3583193e30b0e906c3e3b534a3dfb27e09ea0d9e9dcc65e39ba2c6f1195e5f660850b3de85c0a1fde3a10952e3713997487a1c722c20a9b048718e48b9ee755e8609d3fd9dfb63699a3a148fb0f316fd01a8d008e297a102bfb29b5f4a827313f6cbef2eac9088b1ae3b64685ccadf8e3d5f22acee74afb9988c995f68b6a44d3e1b25a0aee0a7e304d1b507ebb287ef3c1989fd477d62ad086e360503112b8426c55fd9e15374a6a11176dd1acb45d656a65294354d64ee6e73f3e5dbb82ef587d8ad50249693b521138af847b3b3de67f473b482d9d0dc07dd9642ae14ce9719e4c4ad94b17f95fd0553e410c449dabc464118fd0c726a5703dc60a972d2b569d7a521d6e88dbefe58a77e5d048172466b396d521ac1b92ebf367d659859fa75764eb6c204e61220320c947482cb632305f2c765333d3d8b45fc7ef13c002dd76b53eac09dabd811cbc2645fa79f2438c6a0478c0f6942b696ed875a9166a096cb6d75363e2e482828728c12f65f43be';
  }

  /**
   * Initiate a claim
   * @param {Object} claimData - Claim data object
   * @returns {Promise<Object>} - API response
   */
  async initiateClaim(claimData) {
    const {
      // User inputs
      dateOfAdmission,
      diagnosis,
      estimatedCost,
      
      // Policy data
      policyNumber,
      memberFirstName,
      memberLastName,
      memberDob,
      memberGender,
      memberRelation,
      memberUHID,
      mobileNumber,
      emailId,
      communicationAddress,
      communicationCity,
      communicationPincode,
      
      // Hospital data (user selected)
      hospitalName,
      hospitalAddress,
      hospitalAddressLine2,
      hospitalCityTownVillage,
      hospitalDistrict,
      hospitalState,
      hospitalPincode,
      hospitalCountry
    } = claimData;

    // Calculate discharge date (admission date + 2 days)
    const dateOfDischarge = this.calculateDischargeDate(dateOfAdmission);

    // Build the payload
    const payload = {
      // Static fields
      benefitClaim: "false",
      certificateNumber: "",
      coverCode: "",
      estimatedDays: "2",
      hospitalEmailId: "",
      hospitalMobileNo: "",
      hospitalStatus: "PRN Generated",
      isCAG: true,
      isCashlessPayment: "Not Chosen",
      isCreatedFromClaimIntimation: "true",
      isExcludedProvider: "false",
      isExistingProvider: false,
      isHospitalManualEntry: "No",
      isPrePostClaim: false,
      policyDetailsProposerNameFirstName: "",
      policyDetailsProposerNameLastName: "",
      policyDetailsProposerNameMiddleName: "",
      policyTypeForClaim: "Retail",
      prn: "PRN1021142",
      producerAlternateEmail: "UATRETAILHEALTH@TATAAIG.COM",
      producerEmail: "",
      rohiniId: "8900080014039",
      secondOpinion: "false",
      source: "SPA",
      subSource: "MobileApp",
      tpaCode: "1000000023",
      typeOfClaim: "Cashless",
      utmCampaign: "",
      utmMedium: "",
      utmSource: "",
      
      // Dynamic fields from policy data
      communicationAddress: communicationAddress || "",
      communicationCity: communicationCity || "",
      communicationPincode: communicationPincode || "",
      emailId: emailId || "",
      memberDob: memberDob || "",
      memberFirstName: memberFirstName || "",
      memberGender: memberGender || "",
      memberLastName: memberLastName || "",
      memberRelation: memberRelation || "",
      memberUHID: memberUHID || "",
      mobileNumber: mobileNumber || "",
      policyNumber: policyNumber || "",
      
      // User input fields
      dateOfAdmission: dateOfAdmission || "",
      dateOfDischarge: dateOfDischarge || "",
      diagnosis: diagnosis || "",
      illness: diagnosis || "", // Same as diagnosis
      estimatedCost: estimatedCost || "",
      
      // Hospital data (user selected)
      hospitalAddress: hospitalAddress || "",
      hospitalAddressLine2: hospitalAddressLine2 || "",
      hospitalCityTownVillage: hospitalCityTownVillage || "",
      hospitalCountry: hospitalCountry || "INDIA",
      hospitalDistrict: hospitalDistrict || "",
      hospitalName: hospitalName || "",
      hospitalPincode: hospitalPincode || "",
      hospitalState: hospitalState || ""
    };

    console.log('Initiating claim with payload:', JSON.stringify(payload, null, 2));

    // Retry logic for network issues
    const maxRetries = 3;
    const retryDelay = 10000; // 2 seconds

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Making API call (attempt ${attempt}/${maxRetries})...`);
        
        const response = await axios.post(this.apiEndpoint, payload, {
          headers: {
            'accept-version': '2.0.0',
            'Content-Type': 'application/json',
            'x-client': 'android',
            'platform': 'android',
            'X-App-Version': '4.1.2-debug',
            'x-build-number': '2025100802',
            'X-User-ID': '6703cfc70ad5a990e3d1f197',
            'Authorization': `Bearer ${this.authToken}`
          },
          timeout: 30000 // 30 second timeout
        });

        console.log('Claim initiated successfully:', response.data);
        return {
          success: true,
          data: response.data
        };

      } catch (error) {
        console.error(`Claim initiation attempt ${attempt} failed:`, error.response?.data || error.message);
        
        // Check if it's a retryable error
        const isRetryableError = 
          error.code === 'ECONNABORTED' || // Timeout
          error.code === 'ENOTFOUND' ||   // DNS resolution failed
          error.code === 'ECONNREFUSED' || // Connection refused
          error.code === 'ETIMEDOUT' ||   // Connection timeout
          error.response?.status === 504 || // Gateway timeout
          error.response?.status === 502 || // Bad gateway
          error.response?.status === 503 || // Service unavailable
          (error.response?.data && typeof error.response.data === 'string' && error.response.data.includes('504 Gateway Timeout'));

        if (isRetryableError && attempt < maxRetries) {
          console.log(`Retrying in ${retryDelay}ms... (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }

        // Final attempt failed or non-retryable error
        console.error('Claim initiation failed after all retries:', error.response?.data || error.message);
        return {
          success: false,
          error: error.response?.data || { 
            message: error.message,
            code: error.code,
            status: error.response?.status
          }
        };
      }
    }
  }

  /**
   * Calculate discharge date (admission date + 2 days)
   * @param {string} admissionDate - Admission date in DD-MM-YYYY format
   * @returns {string} - Discharge date in DD-MM-YYYY format
   */
  calculateDischargeDate(admissionDate) {
    try {
      // Parse DD-MM-YYYY format
      const parts = admissionDate.split('-');
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
      const year = parseInt(parts[2], 10);
      
      const date = new Date(year, month, day);
      
      // Add 2 days
      date.setDate(date.getDate() + 2);
      
      // Format back to DD-MM-YYYY
      const newDay = String(date.getDate()).padStart(2, '0');
      const newMonth = String(date.getMonth() + 1).padStart(2, '0');
      const newYear = date.getFullYear();
      
      return `${newDay}-${newMonth}-${newYear}`;
    } catch (error) {
      console.error('Error calculating discharge date:', error);
      return admissionDate; // Return original if error
    }
  }

  /**
   * Build claim data from policy info and user inputs
   * @param {Object} policyInfo - Policy information
   * @param {Object} userInputs - User provided inputs
   * @param {Object} hospitalData - Selected hospital data
   * @returns {Object} - Complete claim data object
   */
  buildClaimData(policyInfo, userInputs, hospitalData) {
    // Find the member who needs admission
    let member = null;
    if (userInputs.memberRelation) {
      member = policyInfo.insuredMembers?.find(m => 
        m.relationship.toLowerCase() === userInputs.memberRelation.toLowerCase()
      );
    }
    
    if (!member && policyInfo.insuredMembers && policyInfo.insuredMembers.length > 0) {
      member = policyInfo.insuredMembers[0]; // Default to first member
    }

    return {
      // User inputs
      dateOfAdmission: userInputs.dateOfAdmission,
      diagnosis: userInputs.diagnosis,
      estimatedCost: userInputs.estimatedCost,
      
      // Policy data
      policyNumber: policyInfo.policyNumber,
      memberFirstName: member?.name.split(' ')[0] || '',
      memberLastName: member?.name.split(' ').slice(1).join(' ') || '',
      memberDob: member?.dob ? this.formatDateForAPI(member.dob) : '',
      memberGender: userInputs.memberGender || 'Female',
      memberRelation: member?.relationship || 'Self',
      memberUHID: member?.memberId || '',
      mobileNumber: userInputs.mobileNumber || '9830323302',
      emailId: userInputs.emailId || 'customer@example.com',
      communicationAddress: userInputs.communicationAddress || '',
      communicationCity: userInputs.communicationCity || '',
      communicationPincode: userInputs.communicationPincode || '',
      
      // Hospital data
      hospitalName: hospitalData?.hospitalName || '',
      hospitalAddress: hospitalData?.hospitalAddress || '',
      hospitalAddressLine2: hospitalData?.city || '',
      hospitalCityTownVillage: hospitalData?.city || '',
      hospitalDistrict: hospitalData?.zone || '',
      hospitalState: hospitalData?.state || '',
      hospitalPincode: hospitalData?.pincode || '',
      hospitalCountry: 'INDIA'
    };
  }

  /**
   * Format date from "DD MMM YYYY" to "YYYY-MM-DD HH:mm:ss"
   * @param {string} dateStr - Date string like "15 Jun 1988"
   * @returns {string} - Formatted date
   */
  formatDateForAPI(dateStr) {
    try {
      const monthMap = {
        'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
        'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
        'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
      };
      
      const parts = dateStr.split(' ');
      const day = parts[0];
      const month = monthMap[parts[1]];
      const year = parts[2];
      
      return `${year}-${month}-${day} 00:00:00`;
    } catch (error) {
      console.error('Error formatting date:', error);
      return dateStr;
    }
  }
}

module.exports = ClaimInitiationService;

