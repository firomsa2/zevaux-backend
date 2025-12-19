// // tests/testRAG.ts
// import { VectorSearchService } from "../services/vectorSearchService.js";
// import { supabase } from "../utils/supabase.js";

// async function testRAG() {
//   const businessId = "91cf1656-9075-4bd9-94d1-c17d386bc4ea"; // test business id

//   console.log("Testing RAG integration...");

//   // Test embedding generation
//   console.log("\n1. Testing embedding generation:");
//   const embedding = await VectorSearchService.generateEmbedding(
//     // "What are your opening hours?"
//     "Full calendar integration"
//   );
//   console.log(`Embedding length: ${embedding.length}`);
//   console.log(`First 3 values: ${embedding.slice(0, 3)}`);

//   // Test vector search
//   console.log("\n2. Testing vector search:");
//   const results = await VectorSearchService.vectorSearch(
//     businessId,
//     "Realtime Monitoring",
//     { topK: 3 }
//   );

//   console.log(`Found ${results.length} results:`);
//   results.forEach((r, i) => {
//     console.log(`  ${i + 1}. Similarity: ${r.similarity.toFixed(3)}`);
//     console.log(`     Content: ${r.content.substring(0, 100)}...`);
//   });

//   // Test hybrid search
//   console.log("\n3. Testing hybrid search:");
//   const hybridResults = await VectorSearchService.hybridSearch(
//     businessId,
//     "Zevaux Phase 1 – Developer Guide ",
//     { vectorTopK: 3 }
//   );

//   hybridResults.forEach((r, i) => {
//     console.log(
//       `  ${i + 1}. [${r.searchType}] Similarity: ${r.similarity.toFixed(3)}`
//     );
//   });

//   // Test stats
//   console.log("\n4. Testing stats:");
//   const stats = await VectorSearchService.getKnowledgeStats(businessId);
//   console.log(`Total chunks: ${stats.totalChunks}`);
//   console.log(`Total documents: ${stats.totalDocuments}`);
//   console.log(`Languages: ${stats.languages.join(", ")}`);
// }

// testRAG().catch(console.error);
