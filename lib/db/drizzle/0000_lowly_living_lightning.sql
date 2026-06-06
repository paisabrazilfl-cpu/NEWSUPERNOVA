CREATE TABLE "agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'idle' NOT NULL,
	"color" text NOT NULL,
	"avatar_initials" text,
	"model" text,
	"context_used" integer DEFAULT 0 NOT NULL,
	"context_max" integer DEFAULT 128000 NOT NULL,
	"capabilities" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'general' NOT NULL,
	"description" text,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_activity" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"agent_id" integer,
	"agent_name" text,
	"agent_color" text,
	"content" text NOT NULL,
	"message_type" text DEFAULT 'user' NOT NULL,
	"metadata" text,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"agent_id" integer,
	"agent_name" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"channel_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "monologue_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"text" text NOT NULL,
	"type" text DEFAULT 'thought' NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"tool_name" text NOT NULL,
	"args" text,
	"result" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "agent_commands" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_agent_id" integer NOT NULL,
	"to_agent_id" integer,
	"command" text NOT NULL,
	"payload" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"result" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "cron_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"name" text NOT NULL,
	"schedule" text NOT NULL,
	"task" text NOT NULL,
	"payload" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_result" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
