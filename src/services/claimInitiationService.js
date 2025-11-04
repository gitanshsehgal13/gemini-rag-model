const axios = require('axios');

/**
 * Claim Initiation Service
 * Handles claim initiation API calls to Tata AIG
 */
class ClaimInitiationService {
  constructor(config = {}) {
    this.apiEndpoint = config.apiEndpoint || 'https://alpha10bn.tataaig.com/servicing/api/health/claims/initiate-claim';
    this.authToken = config.authToken || '4b0d94ee5dd4639728975f3d7dc91ec8:6d39afb582d1e37d4be47fb9e2a3f5a7f00ec92dadd2b266013c0b3523f77a18fc72e17ebd0b3f4e0ee42b1e163615a574ed49507a136e2f49f4608fdcab0845635c0d593f0b4d938c2d5d03cc494055b7564db40cfb0ee3ff72ea0a5c3be31f086c89ea36a555e11859dd253961d160a7bb2e7134760ef077a23144a93f10cf0cc5040620c3ce25e92968fcfb5c445fc3f5142d9405750e1ca142455ee15ec9f10a40c041f232874a246b92c79f61435ef1ac39d29774f0fa9f922918010e572ba487805bc5c38fe0faa02f58a2bc1bdfdfd98014229ec9d50d884336f45c351ea8e09afc4e82332e41ace5897e67e669536656d6012a0c70df8d5da11ae71699f559c32e5b8ce079816d0426500a0a4091698e02598d863907faf446a4ed61e5293cdea253fab180f0d2d5268b637db42145eb7998cc7b73f3d1254136abff0a4bad46ef9e0d7c5b44b9448a7f2cc4121bb774701860cc0f988cd7ee1f3cc2c1da4a2fa57e68f5d353af525542019892011a917b9792b48e2128e1619900b626436798238369ca1f04354b5396a1f0cbfe90dbc896e29d043eaf90dbab5d8cbfebd5bbf4bbed7bbd890ea3175a94406357cd217df26d9071e94999b4ff7bb3ac2a19efb6aabdeeb973e2434f68bf4a376cbf41bdddd3b1256d6e9cff36bb26c8053b59776226ed652633984fdaee1b08d0c7d362e155a8d5997990454f52c41ba3d46ac483e4b6e33552a93c5dfe23956d3b7cfca98c3732c863420eda46708d9ef873fb33c0db24062d6d1a647debbd7a21af11a18a1dd77e0df4d209e224ab048afb857cf8c5bdcd4b7ba926ac1708f175a72ecdd874de148615ec5707e64156c56d20bc9f0fa6a43d30914409df1e30d3553f2b36a65faff0ff82c291b8bd193c071fde5def4b01814b9a956d27beddd9b1c6299deab55b5626d564ac88952825637f3b74be5f03030aa316acab';
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

