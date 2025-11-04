const axios = require('axios');

/**
 * Claim Initiation Service
 * Handles claim initiation API calls to Tata AIG
 */
class ClaimInitiationService {
  constructor(config = {}) {
    this.apiEndpoint = config.apiEndpoint || 'https://alpha10bn.tataaig.com/servicing/api/health/claims/initiate-claim';
    this.authToken = config.authToken || 'e00f7876f21519a046a81de8967f587d:0173d9b9bfa4c0b1be3b14bbb48a9f4322ed73e6bb2df580d8d8372a650c544adfa8a3972b0d05a1ef84c3e0ea79495633dfd3c28324fb2cd08816ed770c4a3465f6b08699796fcefd111fbacb162c42e2165f2178226d4beb8f691f2e17a25349286092922ff369e95db1b1fa181ef29d470be1e7314673945dca918f68faf53430ed7422b2e4d7caa0c4e1a5ff7372937972fce1d94af28ae48c56048e7e8d39b2ce4d893c8ac88cf61e255b1acb174f62995cf29c1ec558059a3dc5171d2f9958c39310d33cc7d83dee45c0afa52b31c9d16420fdf0560a8b2ae4f0d227e507c4255a04e4b1e1303e4a9f0ce91be248885da03ef48547538dbf2195cd2061b98eebc1698f73516fa7b235032b4411abc6d8fe2d9a4df43ef527c48c30affd27662d8583f0b1e865c76a46cdd2a0d63bf58860348249dafab6afb20c6a6d9f0e25a264fe5ce60086e985edaaa936412cf0d22c4a95eb3817bdb3e75c6a0602fab10f7f70df32fb42037a837dfb12927c2ca5846f8690bf41f21cdee5c4c330ac9bb584a040cf29d56d8d8acb538496afc7180b1f0cf3d83136bbeda2c575a50dc696d607c07f8313366d4ce0bb761f4cf0a6d0eb2d7daa305e804576603fd6d6be6f9c6cc35e19ebffe3bcf123ba43a6d2b97a28c9cfa01557852aae1252bc730e7728a9838f7953978c5925c9b06353566d8531fb81917e04c35b0edd2e7faf0a589adb3d5828b253f084509a9cd3c6ae72539a1b7a1bab8cc78e69eeb8df1d602b5c82d61e7cded05d1a0520c4bfd51ffedd68dce9d1c9f3057f2041c729f0429766c9927704fc21ec397875770df23e1da87ac03e867552887985b9daaa366a32631cf3ab86a0b2a15e5e4159d5e5188502599cf203560bd4998f4eae00ebd6df2b9013de932b447efbdefadc2cbf95e1ac2ee10c73f42110c289c2056023e028ece3dcaf91c70659d689c75e41';
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

