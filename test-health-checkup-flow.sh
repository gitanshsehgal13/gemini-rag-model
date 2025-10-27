#!/bin/bash

API_URL="http://localhost:3000/api/customers/9830323302/query"
INTENT="HEALTH_CHECKUP_BOOKING_JOURNEY"

echo "=========================================="
echo "🧪 Testing Health Checkup Journey Flow"
echo "=========================================="
echo ""

# Test 1: Initial nudge response (should skip greeting and go to identify_member)
echo "📝 Test 1: User responds 'yes' to external nudge"
echo "Expected: Should go directly to identify_member stage"
RESPONSE1=$(curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"yes\", \"intent\": \"$INTENT\"}")

CONV_ID=$(echo "$RESPONSE1" | jq -r '.conversationId')
STAGE1=$(echo "$RESPONSE1" | jq -r '.currentStage')
ANSWER1=$(echo "$RESPONSE1" | jq -r '.answer')

echo "Conversation ID: $CONV_ID"
echo "Current Stage: $STAGE1"
echo "AI Response: $ANSWER1"
echo ""
echo "✅ Test 1: Stage should be 'identify_member'"
echo "Actual: $STAGE1"
echo ""

# Test 2: Select family member
echo "=========================================="
echo "📝 Test 2: User selects 'myself'"
echo "Expected: Should transition to show_package_options"
RESPONSE2=$(curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"myself\", \"intent\": \"$INTENT\", \"conversationId\": \"$CONV_ID\"}")

STAGE2=$(echo "$RESPONSE2" | jq -r '.currentStage')
ANSWER2=$(echo "$RESPONSE2" | jq -r '.answer')
SELECTED_MEMBERS=$(echo "$RESPONSE2" | jq -r '.collectedData.selectedMembers[]' 2>/dev/null || echo "")

echo "Current Stage: $STAGE2"
echo "Selected Members: $SELECTED_MEMBERS"
echo "AI Response: $ANSWER2"
echo ""
echo "✅ Test 2: Stage should be 'show_package_options'"
echo "Actual: $STAGE2"
echo ""

# Test 3: Accept package
echo "=========================================="
echo "📝 Test 3: User accepts package with 'yes'"
echo "Expected: Should transition to collect_scheduling_details"
RESPONSE3=$(curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"yes\", \"intent\": \"$INTENT\", \"conversationId\": \"$CONV_ID\"}")

STAGE3=$(echo "$RESPONSE3" | jq -r '.currentStage')
ANSWER3=$(echo "$RESPONSE3" | jq -r '.answer')
SELECTED_PACKAGE=$(echo "$RESPONSE3" | jq -r '.collectedData.selectedPackage' 2>/dev/null || echo "")

echo "Current Stage: $STAGE3"
echo "Selected Package: $SELECTED_PACKAGE"
echo "AI Response: $ANSWER3"
echo ""
echo "✅ Test 3: Stage should be 'collect_scheduling_details'"
echo "Actual: $STAGE3"
echo ""

# Test 4: Provide date and time
echo "=========================================="
echo "📝 Test 4: User provides date and time"
echo "Expected: Should transition to confirm_appointment"
RESPONSE4=$(curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"October 25th at 10:00 AM\", \"intent\": \"$INTENT\", \"conversationId\": \"$CONV_ID\"}")

STAGE4=$(echo "$RESPONSE4" | jq -r '.currentStage')
ANSWER4=$(echo "$RESPONSE4" | jq -r '.answer')
DATE=$(echo "$RESPONSE4" | jq -r '.collectedData.preferredDate' 2>/dev/null || echo "")
TIME=$(echo "$RESPONSE4" | jq -r '.collectedData.preferredTime' 2>/dev/null || echo "")

echo "Current Stage: $STAGE4"
echo "Preferred Date: $DATE"
echo "Preferred Time: $TIME"
echo "AI Response: $ANSWER4"
echo ""
echo "✅ Test 4: Stage should be 'confirm_appointment'"
echo "Actual: $STAGE4"
echo ""

# Summary
echo "=========================================="
echo "📊 Test Summary"
echo "=========================================="
echo "Test 1 (Nudge Response):     $STAGE1 (expected: identify_member)"
echo "Test 2 (Select Member):      $STAGE2 (expected: show_package_options)"
echo "Test 3 (Accept Package):     $STAGE3 (expected: collect_scheduling_details)"
echo "Test 4 (Provide DateTime):   $STAGE4 (expected: confirm_appointment)"
echo ""

if [ "$STAGE1" = "identify_member" ] && [ "$STAGE2" = "show_package_options" ] && [ "$STAGE3" = "collect_scheduling_details" ] && [ "$STAGE4" = "confirm_appointment" ]; then
    echo "✅ ALL TESTS PASSED!"
else
    echo "❌ SOME TESTS FAILED - Check logs for details"
fi

