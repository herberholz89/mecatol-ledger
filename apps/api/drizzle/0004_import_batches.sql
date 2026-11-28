CREATE TABLE "import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_by" uuid NOT NULL,
	"source_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_source_name_check" CHECK (char_length("import_batches"."source_name") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "import_batch_id" integer;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batches_created_by_idx" ON "import_batches" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "games_import_batch_idx" ON "games" USING btree ("import_batch_id");