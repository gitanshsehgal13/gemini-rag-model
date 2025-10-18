const ClaimInitiationService = require('./src/services/claimInitiationService');
const fs = require('fs');
const path = require('path');

/**
 * Test script for Claim Initiation Service
 */

async function testClaimInitiation() {
  console.log('🏥 Testing Claim Initiation Service\n');
  console.log('='.repeat(60));

  // Load policy info
  const policyInfo = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'data/policyInfo.json'), 'utf8')
  );

  // Initialize service (auth token is now inside the service)
  const claimService = new ClaimInitiationService();

  // Sample user inputs
  const userInputs = {
    dateOfAdmission: '13-10-2025',
    diagnosis: 'illness',
    estimatedCost: '23000',
    memberRelation: 'Spouse', // Looking for admission for spouse
    mobileNumber: '8810533773',
    emailId: 'kanishka.pal@tataaig.com',
    communicationAddress: '6TH FLOOR, UNITECH CYBER PARK TOWER-C',
    communicationCity: 'Gurgaon',
    communicationPincode: '140001',
    memberGender: 'Female'
  };

  // Sample hospital data (user selected)
  const hospitalData = {
    hospitalName: 'Sarvodaya Hospital',
    hospitalAddress: '1031/1, Railway Road, Near Mata Chintapurni Mandir, Gurugram, Gurugram',
    hospitalAddressLine2: 'Gurugram',
    city: 'Gurugram',
    hospitalCityTownVillage: 'Gurugram',
    hospitalDistrict: 'GURGAON',
    state: 'HARYANA',
    hospitalState: 'HARYANA',
    pincode: '122001',
    hospitalPincode: '122001',
    hospitalCountry: 'INDIA'
  };

  console.log('\n📋 Building claim data...\n');
  
  // Build complete claim data
  const claimData = claimService.buildClaimData(policyInfo, userInputs, hospitalData);
  
  console.log('Claim Data Built:', JSON.stringify(claimData, null, 2));
  
  console.log('\n📤 Initiating claim...\n');
  
  // Initiate the claim
  const result = await claimService.initiateClaim(claimData);
  
  if (result.success) {
    console.log('✅ Claim initiated successfully!');
    console.log('Response:', JSON.stringify(result.data, null, 2));
  } else {
    console.log('❌ Claim initiation failed!');
    console.log('Error:', JSON.stringify(result.error, null, 2));
  }

  console.log('\n' + '='.repeat(60));
  console.log('✨ Test completed!\n');
}

// Run the test
if (require.main === module) {
  testClaimInitiation().catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
}

module.exports = testClaimInitiation;

