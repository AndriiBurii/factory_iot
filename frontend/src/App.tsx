import { useEffect, useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./App.css";

interface ProductionData {
  printer_speed: number;
  cutter_pressure: number;
  sauce_temp: number;
}

interface Anomaly {
  machineId: string;
  value: number;
  createdAt: string;
}

interface ChartPoint {
  time: string;
  printer: number;
  cutter: number;
  sauce: number;
}

function App() {
  const [metrics, setMetrics] = useState<ProductionData | null>(null);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [chartData, setChartData] = useState<ChartPoint[]>([]);

  const [activeTab, setActiveTab] = useState<string>("anomalies");

  useEffect(() => {
    // 1. Rechest historical anomalies from GraphQL when the component mounts
    const fetchAnomaliesHistory = async () => {
      try {
        const response = await fetch("http://localhost:8080/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: "{ anomalies { machineId value createdAt } }",
          }),
        });
        const result = await response.json();
        if (result.data?.anomalies) setAnomalies(result.data.anomalies);
      } catch (error) {
        console.error("GraphQL Error:", error);
      }
    };
    fetchAnomaliesHistory();

    // 2. Connect to WebSockets for real-time data updates
    const ws = new WebSocket("ws://localhost:8080/ws");

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      // Updating current metrics (from Redis)
      if (data.metrics) {
        setMetrics(data.metrics);
        const now = new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        setChartData((prev) => [
          ...prev.slice(-14),
          {
            time: now,
            printer: Number(data.metrics.printer_speed),
            cutter: Number(data.metrics.cutter_pressure),
            sauce: Number(data.metrics.sauce_temp),
          },
        ]);
      }

      // If there are anomalies - show them and add to the table
      if (data.anomalies && data.anomalies.length > 0) {
        data.anomalies.forEach((anomaly: Anomaly) => {
          // Show a red toast notification
          toast.error(
            `⚠️ ALERT: ${anomaly.machineId} value is ${anomaly.value.toFixed(1)}!`,
            {
              position: "top-right",
              autoClose: 5000,
              theme: "dark",
            },
          );

          // Add the new anomaly to the top of the list (keeping only the latest 10)
          setAnomalies((prev) => [anomaly, ...prev].slice(0, 10));
        });
      }
    };

    // Close WebSocket connection when the component unmounts
    return () => ws.close();
  }, []);

  const formatTime = (dateString: string) =>
    new Date(dateString).toLocaleTimeString();

  return (
    <div className="dashboard">
      {/* Toast Container */}
      <ToastContainer />

      <h1>🖨️ Sticker Mule Production Live</h1>

      <div className="sensors-grid">
        <div className="sensor-card">
          <h2>Digital Printer</h2>
          <p className="temp">
            {metrics ? metrics.printer_speed.toFixed(0) : "--"}{" "}
            <span style={{ fontSize: "0.5em" }}>mm/s</span>
          </p>
        </div>
        <div className="sensor-card">
          <h2>Die-Cutter</h2>
          <p className="temp" style={{ color: "#2196F3" }}>
            {metrics ? metrics.cutter_pressure.toFixed(1) : "--"}{" "}
            <span style={{ fontSize: "0.5em" }}>kg</span>
          </p>
        </div>
        <div className="sensor-card">
          <h2>Mule Sauce Line</h2>
          <p className="temp" style={{ color: "#FF9800" }}>
            {metrics ? metrics.sauce_temp.toFixed(1) : "--"}{" "}
            <span style={{ fontSize: "0.5em" }}>°C</span>
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="controls">
        <button
          className={activeTab === "anomalies" ? "active" : ""}
          onClick={() => setActiveTab("anomalies")}
        >
          ⚠️ Anomaly Log
        </button>
        <button
          className={activeTab === "printer" ? "active" : ""}
          onClick={() => setActiveTab("printer")}
        >
          📈 Printer Speed
        </button>
        <button
          className={activeTab === "cutter" ? "active" : ""}
          onClick={() => setActiveTab("cutter")}
        >
          📈 Cutter Pressure
        </button>
        <button
          className={activeTab === "sauce" ? "active" : ""}
          onClick={() => setActiveTab("sauce")}
        >
          📈 Sauce Temp
        </button>
      </div>

      <div className="content-panel">
        {activeTab === "anomalies" && (
          <div className="anomalies-section">
            <h2>⚠️ Recent Production Alerts</h2>
            {anomalies.length === 0 ? (
              <p>All systems operating normally.</p>
            ) : (
              <table className="anomalies-table">
                <thead>
                  <tr>
                    <th>Equipment</th>
                    <th>Recorded Value</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {anomalies.map((anomaly, index) => (
                    <tr key={index}>
                      <td>{anomaly.machineId}</td>
                      <td className="danger">{anomaly.value.toFixed(1)}</td>
                      <td>{formatTime(anomaly.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Chart Section */}
        {activeTab === "printer" && (
          <div className="chart-section">
            <h2>Digital Printer Speed (mm/s)</h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="time" stroke="#888" />
                <YAxis domain={[0, 700]} stroke="#888" />
                <Tooltip
                  contentStyle={{ backgroundColor: "#222", border: "none" }}
                />
                <Line
                  type="monotone"
                  dataKey="printer"
                  stroke="#4CAF50"
                  strokeWidth={3}
                  dot={false}
                  animationDuration={300}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {activeTab === "cutter" && (
          <div className="chart-section">
            <h2>Die-Cutter Pressure (kg)</h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="time" stroke="#888" />
                <YAxis domain={[0, 100]} stroke="#888" />
                <Tooltip
                  contentStyle={{ backgroundColor: "#222", border: "none" }}
                />
                <Line
                  type="monotone"
                  dataKey="cutter"
                  stroke="#2196F3"
                  strokeWidth={3}
                  dot={false}
                  animationDuration={300}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {activeTab === "sauce" && (
          <div className="chart-section">
            <h2>Mule Sauce Temperature (°C)</h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="time" stroke="#888" />
                <YAxis domain={[60, 110]} stroke="#888" />
                <Tooltip
                  contentStyle={{ backgroundColor: "#222", border: "none" }}
                />
                <Line
                  type="monotone"
                  dataKey="sauce"
                  stroke="#FF9800"
                  strokeWidth={3}
                  dot={false}
                  animationDuration={300}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
