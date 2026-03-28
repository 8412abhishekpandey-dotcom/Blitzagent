/**
 * Test Harness — Run the agent against sample websites
 * 
 * Usage: node test.js
 * Requires MERCURY_API_KEY in .env
 */

import { runAgent } from './agent/loop.js';
import dotenv from 'dotenv';
dotenv.config();

// ── Test Cases ──────────────────────────────────────────────────────────────

const testCases = [
  {
    name: 'Extract page title from Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Web_browser',
    task: 'Extract the main heading (title) of this Wikipedia article and report it back.',
  },
  {
    name: 'Search on Google',
    url: 'https://www.google.com',
    task: 'Search for "browser automation agent" in the search box and click the search button.',
  },
  {
    name: 'Fill a demo form',
    url: 'https://httpbin.org/forms/post',
    task: 'Fill out the form with: customer name "John Doe", telephone "555-1234", email "john@example.com", size "Large", topping "Bacon". Then submit the form.',
  },
  {
    name: 'Navigate and extract data',
    url: 'https://quotes.toscrape.com',
    task: 'Extract the first 3 quotes and their authors from the page.',
  },
];

// ── Runner ──────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('🧪 Browser Automation Agent — Test Suite\n');
  console.log('═'.repeat(60));

  if (!process.env.MERCURY_API_KEY || process.env.MERCURY_API_KEY === 'your_api_key_here') {
    console.error('❌ Please set MERCURY_API_KEY in your .env file');
    console.log('   Get your free API key at: https://inceptionlabs.ai');
    process.exit(1);
  }

  // Run a specific test or all tests
  const testIndex = parseInt(process.argv[2]);
  const cases = !isNaN(testIndex) ? [testCases[testIndex]] : testCases;

  let passed = 0;
  let failed = 0;

  for (const tc of cases) {
    if (!tc) continue;
    console.log(`\n🔬 Test: ${tc.name}`);
    console.log(`   URL:  ${tc.url}`);
    console.log(`   Task: ${tc.task}`);
    console.log('─'.repeat(60));

    try {
      const result = await runAgent({
        task: tc.task,
        startUrl: tc.url,
        taskId: `test-${Date.now().toString(36)}`,
        onStep: (step) => {
          const icon = step.success ? '✅' : '❌';
          console.log(`   ${icon} Step ${step.step}: ${step.action}(${JSON.stringify(step.params).slice(0, 60)}) → ${step.result}`);
        },
      });

      console.log(`\n   Result: ${result.success ? '✅ PASSED' : '❌ FAILED'}`);
      console.log(`   Message: ${result.result || result.error || 'No result'}`);
      console.log(`   Steps: ${result.steps.length} | Tokens: ${result.totalTokens}`);

      if (result.extractedData) {
        console.log(`   Data: ${result.extractedData.slice(0, 200)}`);
      }

      if (result.success) passed++;
      else failed++;
    } catch (err) {
      console.log(`   ❌ Error: ${err.message}`);
      failed++;
    }

    console.log('─'.repeat(60));
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`📊 Results: ${passed} passed, ${failed} failed out of ${cases.length} tests`);
  console.log('═'.repeat(60));
}

runTests().catch(console.error);
