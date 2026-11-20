CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"migration_id" uuid NOT NULL,
	"method" text NOT NULL,
	"status" text NOT NULL,
	"phase" text DEFAULT 'persons' NOT NULL,
	"range_from" timestamp with time zone NOT NULL,
	"range_to" timestamp with time zone NOT NULL,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"estimated_rows" integer,
	"imported_events" integer DEFAULT 0 NOT NULL,
	"imported_persons" integer DEFAULT 0 NOT NULL,
	"duplicate_events" integer DEFAULT 0 NOT NULL,
	"failed_rows" integer DEFAULT 0 NOT NULL,
	"failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_by" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"posthog_source_id" uuid,
	"native_source_id" uuid NOT NULL,
	"posthog_project_token" text,
	"capture_host" text NOT NULL,
	"assets_host" text NOT NULL,
	"forwarding" boolean DEFAULT true NOT NULL,
	"product_usage" jsonb,
	"tracking_first_seen_at" timestamp with time zone,
	"tracking_last_seen_at" timestamp with time zone,
	"captured_via_proxy" integer DEFAULT 0 NOT NULL,
	"forwarded_requests" integer DEFAULT 0 NOT NULL,
	"forward_failures" integer DEFAULT 0 NOT NULL,
	"last_forward_error" text,
	"acknowledged_gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"cutover_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_migration_id_migrations_id_fk" FOREIGN KEY ("migration_id") REFERENCES "public"."migrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migrations" ADD CONSTRAINT "migrations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migrations" ADD CONSTRAINT "migrations_posthog_source_id_sources_id_fk" FOREIGN KEY ("posthog_source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migrations" ADD CONSTRAINT "migrations_native_source_id_sources_id_fk" FOREIGN KEY ("native_source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_jobs_migration_idx" ON "import_jobs" USING btree ("migration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "migrations_project_idx" ON "migrations" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "migrations_token_idx" ON "migrations" USING btree ("posthog_project_token");