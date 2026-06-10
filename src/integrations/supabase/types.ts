export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          bank_name: string
          card_holder: string
          card_number: string
          id: number
          price_1month: number
          price_3month: number
          price_6month: number
          updated_at: string
        }
        Insert: {
          bank_name?: string
          card_holder?: string
          card_number?: string
          id?: number
          price_1month?: number
          price_3month?: number
          price_6month?: number
          updated_at?: string
        }
        Update: {
          bank_name?: string
          card_holder?: string
          card_number?: string
          id?: number
          price_1month?: number
          price_3month?: number
          price_6month?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          end_date: string | null
          first_name: string | null
          id: string
          last_name: string | null
          plan: Database["public"]["Enums"]["subscription_plan"] | null
          start_date: string | null
          status: Database["public"]["Enums"]["profile_status"]
          username: string
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          first_name?: string | null
          id: string
          last_name?: string | null
          plan?: Database["public"]["Enums"]["subscription_plan"] | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["profile_status"]
          username: string
        }
        Update: {
          created_at?: string
          end_date?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          plan?: Database["public"]["Enums"]["subscription_plan"] | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["profile_status"]
          username?: string
        }
        Relationships: []
      }
      signup_requests: {
        Row: {
          created_at: string
          first_name: string
          id: string
          last_name: string
          password_set: boolean
          payment_confirmed: boolean
          plan: Database["public"]["Enums"]["subscription_plan"]
          receipt_url: string | null
          reviewed_at: string | null
          status: Database["public"]["Enums"]["request_status"]
          username: string
        }
        Insert: {
          created_at?: string
          first_name: string
          id?: string
          last_name: string
          password_set?: boolean
          payment_confirmed?: boolean
          plan: Database["public"]["Enums"]["subscription_plan"]
          receipt_url?: string | null
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          username: string
        }
        Update: {
          created_at?: string
          first_name?: string
          id?: string
          last_name?: string
          password_set?: boolean
          payment_confirmed?: boolean
          plan?: Database["public"]["Enums"]["subscription_plan"]
          receipt_url?: string | null
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          username?: string
        }
        Relationships: []
      }
      user_data: {
        Row: {
          categories: Json
          current_invoice: Json | null
          invoices: Json
          products: Json
          settings: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          categories?: Json
          current_invoice?: Json | null
          invoices?: Json
          products?: Json
          settings?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          categories?: Json
          current_invoice?: Json | null
          invoices?: Json
          products?: Json
          settings?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      profile_status: "pending" | "active" | "expired" | "rejected"
      request_status: "pending" | "approved" | "rejected"
      subscription_plan: "1month" | "3month" | "6month"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      profile_status: ["pending", "active", "expired", "rejected"],
      request_status: ["pending", "approved", "rejected"],
      subscription_plan: ["1month", "3month", "6month"],
    },
  },
} as const
