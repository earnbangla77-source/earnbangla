import { onRequestGet as __api_admin_dashboard_stats_js_onRequestGet } from "C:\\Users\\AC\\OneDrive\\Documents\\incm website\\functions\\api\\admin\\dashboard-stats.js"
import { onRequestGet as __api_admin_users_js_onRequestGet } from "C:\\Users\\AC\\OneDrive\\Documents\\incm website\\functions\\api\\admin\\users.js"
import { onRequestGet as __api_admin_withdrawals_js_onRequestGet } from "C:\\Users\\AC\\OneDrive\\Documents\\incm website\\functions\\api\\admin\\withdrawals.js"
import { onRequestPost as __api_admin_withdrawals_update_js_onRequestPost } from "C:\\Users\\AC\\OneDrive\\Documents\\incm website\\functions\\api\\admin\\withdrawals-update.js"
import { onRequestPost as __api_auth_forgot_password_js_onRequestPost } from "C:\\Users\\AC\\OneDrive\\Documents\\incm website\\functions\\api\\auth\\forgot-password.js"
import { onRequestPost as __api_auth_login_js_onRequestPost } from "C:\\Users\\AC\\OneDrive\\Documents\\incm website\\functions\\api\\auth\\login.js"
import { onRequestPost as __api_auth_logout_js_onRequestPost } from "C:\\Users\\AC\\OneDrive\\Documents\\incm website\\functions\\api\\auth\\logout.js"
import { onRequestGet as __api_auth_me_js_onRequestGet } from "C:\\Users\\AC\\OneDrive\\Documents\\incm website\\functions\\api\\auth\\me.js"
import { onRequestPost as __api_auth_register_js_onRequestPost } from "C:\\Users\\AC\\OneDrive\\Documents\\incm website\\functions\\api\\auth\\register.js"
import { onRequestPost as __api_auth_reset_password_js_onRequestPost } from "C:\\Users\\AC\\OneDrive\\Documents\\incm website\\functions\\api\\auth\\reset-password.js"
import { onRequestGet as __api_offers_cpagrip_feed_js_onRequestGet } from "C:\\Users\\AC\\OneDrive\\Documents\\incm website\\functions\\api\\offers\\cpagrip-feed.js"
import { onRequestPost as __api_offers_cpagrip_postback_js_onRequestPost } from "C:\\Users\\AC\\OneDrive\\Documents\\incm website\\functions\\api\\offers\\cpagrip-postback.js"
import { onRequestGet as __api_offers_offery_feed_js_onRequestGet } from "C:\\Users\\AC\\OneDrive\\Documents\\incm website\\functions\\api\\offers\\offery-feed.js"
import { onRequestGet as __api_offers_offery_postback_js_onRequestGet } from "C:\\Users\\AC\\OneDrive\\Documents\\incm website\\functions\\api\\offers\\offery-postback.js"
import { onRequestPost as __api_offers_offery_postback_js_onRequestPost } from "C:\\Users\\AC\\OneDrive\\Documents\\incm website\\functions\\api\\offers\\offery-postback.js"
import { onRequestPost as __api_profile_update_js_onRequestPost } from "C:\\Users\\AC\\OneDrive\\Documents\\incm website\\functions\\api\\profile\\update.js"
import { onRequestGet as __api_withdraw_request_js_onRequestGet } from "C:\\Users\\AC\\OneDrive\\Documents\\incm website\\functions\\api\\withdraw\\request.js"
import { onRequestPost as __api_withdraw_request_js_onRequestPost } from "C:\\Users\\AC\\OneDrive\\Documents\\incm website\\functions\\api\\withdraw\\request.js"
import { onRequestGet as __api_activity_js_onRequestGet } from "C:\\Users\\AC\\OneDrive\\Documents\\incm website\\functions\\api\\activity.js"
import { onRequestGet as __api_leaderboard_js_onRequestGet } from "C:\\Users\\AC\\OneDrive\\Documents\\incm website\\functions\\api\\leaderboard.js"

export const routes = [
    {
      routePath: "/api/admin/dashboard-stats",
      mountPath: "/api/admin",
      method: "GET",
      middlewares: [],
      modules: [__api_admin_dashboard_stats_js_onRequestGet],
    },
  {
      routePath: "/api/admin/users",
      mountPath: "/api/admin",
      method: "GET",
      middlewares: [],
      modules: [__api_admin_users_js_onRequestGet],
    },
  {
      routePath: "/api/admin/withdrawals",
      mountPath: "/api/admin",
      method: "GET",
      middlewares: [],
      modules: [__api_admin_withdrawals_js_onRequestGet],
    },
  {
      routePath: "/api/admin/withdrawals-update",
      mountPath: "/api/admin",
      method: "POST",
      middlewares: [],
      modules: [__api_admin_withdrawals_update_js_onRequestPost],
    },
  {
      routePath: "/api/auth/forgot-password",
      mountPath: "/api/auth",
      method: "POST",
      middlewares: [],
      modules: [__api_auth_forgot_password_js_onRequestPost],
    },
  {
      routePath: "/api/auth/login",
      mountPath: "/api/auth",
      method: "POST",
      middlewares: [],
      modules: [__api_auth_login_js_onRequestPost],
    },
  {
      routePath: "/api/auth/logout",
      mountPath: "/api/auth",
      method: "POST",
      middlewares: [],
      modules: [__api_auth_logout_js_onRequestPost],
    },
  {
      routePath: "/api/auth/me",
      mountPath: "/api/auth",
      method: "GET",
      middlewares: [],
      modules: [__api_auth_me_js_onRequestGet],
    },
  {
      routePath: "/api/auth/register",
      mountPath: "/api/auth",
      method: "POST",
      middlewares: [],
      modules: [__api_auth_register_js_onRequestPost],
    },
  {
      routePath: "/api/auth/reset-password",
      mountPath: "/api/auth",
      method: "POST",
      middlewares: [],
      modules: [__api_auth_reset_password_js_onRequestPost],
    },
  {
      routePath: "/api/offers/cpagrip-feed",
      mountPath: "/api/offers",
      method: "GET",
      middlewares: [],
      modules: [__api_offers_cpagrip_feed_js_onRequestGet],
    },
  {
      routePath: "/api/offers/cpagrip-postback",
      mountPath: "/api/offers",
      method: "POST",
      middlewares: [],
      modules: [__api_offers_cpagrip_postback_js_onRequestPost],
    },
  {
      routePath: "/api/offers/offery-feed",
      mountPath: "/api/offers",
      method: "GET",
      middlewares: [],
      modules: [__api_offers_offery_feed_js_onRequestGet],
    },
  {
      routePath: "/api/offers/offery-postback",
      mountPath: "/api/offers",
      method: "GET",
      middlewares: [],
      modules: [__api_offers_offery_postback_js_onRequestGet],
    },
  {
      routePath: "/api/offers/offery-postback",
      mountPath: "/api/offers",
      method: "POST",
      middlewares: [],
      modules: [__api_offers_offery_postback_js_onRequestPost],
    },
  {
      routePath: "/api/profile/update",
      mountPath: "/api/profile",
      method: "POST",
      middlewares: [],
      modules: [__api_profile_update_js_onRequestPost],
    },
  {
      routePath: "/api/withdraw/request",
      mountPath: "/api/withdraw",
      method: "GET",
      middlewares: [],
      modules: [__api_withdraw_request_js_onRequestGet],
    },
  {
      routePath: "/api/withdraw/request",
      mountPath: "/api/withdraw",
      method: "POST",
      middlewares: [],
      modules: [__api_withdraw_request_js_onRequestPost],
    },
  {
      routePath: "/api/activity",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_activity_js_onRequestGet],
    },
  {
      routePath: "/api/leaderboard",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_leaderboard_js_onRequestGet],
    },
  ]