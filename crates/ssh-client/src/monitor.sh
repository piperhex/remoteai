export LC_ALL=C
case "$(uname -s)" in
  Linux)
    awk '/^cpu / {
      for (i=2; i<=9 && i<=NF; i++) total+=$i
      printf "cpu %.0f %.0f\n", total, $5+$6; exit
    }' /proc/stat
    awk '/^MemTotal:/ {total=$2} /^MemAvailable:/ {avail=$2; found=1}
      END {if (found && total>0) printf "ram %.0f %.0f\n", (total-avail)*1024, total*1024}' /proc/meminfo
    awk -F '[: ]+' '/:/ && $0 !~ /^[[:space:]]*lo:/ {
      sub(/^[[:space:]]+/, ""); rx+=$2; tx+=$10; found=1
    } END {if (found) printf "net %.0f %.0f\n", rx, tx}' /proc/net/dev
    awk '{printf "up %.0f\n", int($1)}' /proc/uptime
    ;;
  Darwin)
    top -l 2 -s 1 -n 0 | awk '/CPU usage:/ {idle=$(NF-1); gsub(/%/, "", idle); found=1}
      END {if (found) printf "busy %.0f\n", 100-idle}'
    vm_stat | awk -v total="$(sysctl -n hw.memsize)" '/page size of/ {size=$(NF-1)}
      /Pages (free|inactive|speculative):/ {gsub(/\./, "", $NF); available+=$NF}
      END {if (size>0 && total>0) printf "ram %.0f %.0f\n", total-available*size, total}'
    netstat -ibn | awk 'NR==1 {for (i=1;i<=NF;i++) {if ($i=="Ibytes") r=i; if ($i=="Obytes") t=i}}
      $1 !~ /^lo[0-9]+$/ && $3 ~ /^<Link/ && r && t {rx+=$r; tx+=$t; found=1}
      END {if (found) printf "net %.0f %.0f\n", rx, tx}'
    sysctl -n kern.boottime | awk -v now="$(date +%s)" '{gsub(/,/, "", $4); if ($4>0) print "up", now-$4}'
    ;;
esac
df -Pk / | awk 'NR==2 && $2>0 {printf "disk %.0f %.0f\n", $3*1024, $2*1024}'
