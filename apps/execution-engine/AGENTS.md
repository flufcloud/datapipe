# Execution Engine Agent Guide

## Mission

Build the Node.js service that handles ML execution and third-party integrations behind stable APIs.

## Own

- service scaffold
- training and inference endpoints
- model artifact handling
- Spotify OAuth and action execution
- adapter boundary for future integrations

## Rules

- Never expose secrets or refresh tokens to the frontend.
- Keep APIs explicit and versionable.
- Treat orchestrator as the caller and coordinator.
- Make training and external actions retry-safe.
- Return structured status and error payloads.

## Required Capabilities

- accept training jobs
- report job status
- run inference on live vectors
- refresh Spotify tokens
- execute mapped consumer actions
