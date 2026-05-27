import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'

export const api = axios.create({ baseURL: BASE })

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const msg = err.response?.data?.detail || err.message || 'Unknown error'
    return Promise.reject(new Error(msg))
  }
)

export const wsUrl = (runId: string) => {
  const base = (import.meta.env.VITE_WS_URL || 'ws://localhost:8000/api/v1').replace(/^http/, 'ws')
  return `${base}/ws/${runId}`
}
