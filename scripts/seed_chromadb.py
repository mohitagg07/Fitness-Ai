#!/usr/bin/env python3
"""
Run this once to seed ChromaDB with all biomechanical guardrail documents.
Usage: python scripts/seed_chromadb.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db.chroma_client import seed_guardrails, get_guardrail_collection

if __name__ == "__main__":
    print("Seeding ChromaDB guardrails...")
    seed_guardrails()

    # Verify
    collection = get_guardrail_collection()
    count = collection.count()
    print(f"Collection '{collection.name}' now has {count} documents.")
    print("Done. ChromaDB is ready.")
