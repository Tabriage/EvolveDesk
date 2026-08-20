.PHONY: build-StorageCredentialBroker

build-StorageCredentialBroker:
	mkdir -p "$(ARTIFACTS_DIR)/deploy/storage-broker/aws-lambda" "$(ARTIFACTS_DIR)/tools" "$(ARTIFACTS_DIR)/app/features"
	cp deploy/storage-broker/aws-lambda/handler.mjs "$(ARTIFACTS_DIR)/deploy/storage-broker/aws-lambda/handler.mjs"
	cp tools/storage-credential-issuers.mjs "$(ARTIFACTS_DIR)/tools/storage-credential-issuers.mjs"
	cp app/features/aws-sigv4.mjs app/features/sync-credential-broker.mjs app/features/sync-storage-recipes.mjs app/features/sync-storage-scope.mjs "$(ARTIFACTS_DIR)/app/features/"
