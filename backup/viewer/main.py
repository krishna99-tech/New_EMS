from flask import Flask, render_template
import sqlite3
import os
import datetime

app = Flask(__name__)
# Use the absolute path to the database file
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'meters.db')

def get_data():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Fetch date-wise summary
    cursor.execute("SELECT DATE(timestamp) as day, COUNT(*) as records FROM meter_data GROUP BY day ORDER BY day DESC;")
    summary_rows = cursor.fetchall()
    
    formatted_rows = []
    for row in summary_rows:
        date_obj = datetime.datetime.strptime(row['day'], '%Y-%m-%d')
        formatted_rows.append({
            'day': row['day'],
            'weekday': date_obj.strftime('%A'),
            'records': row['records']
        })
    
    conn.close()
    return formatted_rows

@app.route('/')
def index():
    summary_rows = get_data()
    return render_template('main.html', summary_rows=summary_rows)

if __name__ == '__main__':
    print("Starting Meter Data Viewer on http://127.0.0.1:5000")
    app.run(host='0.0.0.0',debug=True, port=5000)
